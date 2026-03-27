# Rapid Mode — Solo Doctor Flow

Rapid mode is active when `clinic_mode = 'solo'`.
The doctor handles patient add, queue, and consultation without a receptionist.
Designed for high-volume neighborhood clinics: 40–60 patients/day, single doctor.

---

## Core Principle

No friction. No switching between portals. No forms before the patient is in the chair.
The doctor types mobile + name → one tap → patient is in consultation.
All DPDP compliance happens atomically in a single DB call.

---

## Atomic RPC: start_rapid_consultation

One network request. Creates consent + patient + queue entry in a single transaction.

```sql
CREATE OR REPLACE FUNCTION start_rapid_consultation(
  p_clinic_id       UUID,
  p_doctor_id       UUID,
  p_session_id      UUID,
  p_mobile          TEXT,
  p_name            TEXT,
  p_verbal_consent  BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
  queue_entry_id UUID,
  patient_id     UUID,
  token_number   INTEGER,
  is_new_patient BOOLEAN,
  family_members JSONB  -- populated if mobile matches multiple patients
)
LANGUAGE plpgsql AS $$
DECLARE
  v_patient_id     UUID;
  v_token          INTEGER;
  v_queue_entry_id UUID;
  v_is_new         BOOLEAN := FALSE;
  v_family         JSONB;
  v_consent_ver    TEXT;
BEGIN
  -- 1. Look up existing patients by mobile
  SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'dob', dob))
  INTO v_family
  FROM patients
  WHERE clinic_id = p_clinic_id
    AND mobile = p_mobile
    AND is_anonymized = FALSE;

  -- 2. If multiple matches, return family array for UI selection — do not proceed
  IF jsonb_array_length(COALESCE(v_family,'[]'::jsonb)) > 1 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, FALSE, v_family;
    RETURN;
  END IF;

  -- 3. Single match: use existing patient
  IF jsonb_array_length(COALESCE(v_family,'[]'::jsonb)) = 1 THEN
    v_patient_id := (v_family->0->>'id')::UUID;
    v_is_new := FALSE;
  ELSE
    -- 4. No match: create new patient + consent atomically
    v_is_new := TRUE;
    INSERT INTO patients(clinic_id, name, mobile)
    VALUES (p_clinic_id, p_name, p_mobile)
    RETURNING id INTO v_patient_id;

    -- Get current consent version from clinic config
    SELECT config->>'consent_version' INTO v_consent_ver
    FROM clinics WHERE id = p_clinic_id;

    INSERT INTO patient_consents(
      patient_id, clinic_id, consent_text, consent_version, captured_by
    )
    SELECT
      v_patient_id,
      p_clinic_id,
      content,
      v_consent_ver,
      p_doctor_id  -- doctor's staff_id as capturer
    FROM consent_templates
    WHERE (clinic_id = p_clinic_id OR clinic_id IS NULL)
      AND version = v_consent_ver
      AND language = 'en'
    ORDER BY clinic_id NULLS LAST
    LIMIT 1;
  END IF;

  -- 5. Check consent is valid for existing patients
  IF NOT v_is_new THEN
    SELECT config->>'consent_version' INTO v_consent_ver
    FROM clinics WHERE id = p_clinic_id;

    IF NOT EXISTS (
      SELECT 1 FROM patient_consents
      WHERE patient_id = v_patient_id
        AND clinic_id = p_clinic_id
        AND consent_version = v_consent_ver
        AND is_withdrawn = FALSE
    ) THEN
      -- Existing patient needs re-consent — return signal to UI
      RETURN QUERY SELECT NULL::UUID, v_patient_id, NULL::INTEGER, FALSE,
        jsonb_build_object('needs_reconsent', true);
      RETURN;
    END IF;
  END IF;

  -- 6. Atomic token generation using session_counters lock
  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  -- 7. Create queue entry — status goes directly to IN_CONSULTATION in rapid mode
  INSERT INTO queue_entries(
    clinic_id, session_id, patient_id,
    token_number, token_prefix,
    status, source, identity_verified
  )
  VALUES (
    p_clinic_id, p_session_id, v_patient_id,
    v_token, 'A',
    'IN_CONSULTATION', 'doctor_rapid', TRUE
  )
  RETURNING id INTO v_queue_entry_id;

  RETURN QUERY SELECT v_queue_entry_id, v_patient_id, v_token, v_is_new, NULL::JSONB;
END;
$$;
```

---

## Family Array Handling

If mobile lookup returns multiple patients (family shares phone):

```
UI renders:
┌─────────────────────────────────┐
│ Multiple patients found         │
│ Select the patient in front of  │
│ you:                            │
│                                 │
│  [Rahul Sharma — 45M]           │
│  [Priya Sharma — 42F]           │
│  [Aarav Sharma — 12M]           │
│                                 │
│  [+ New family member]          │
└─────────────────────────────────┘
```

Doctor taps the correct name. RPC is called again with confirmed `patient_id`.
Never auto-select. Never guess. The human confirms.

---

## QR Code Self Check-In (presence-gated)

For solo mode, a QR code is auto-generated during onboarding.
Patients scan it in the waiting area and add themselves to the queue.

### Presence gate — three conditions must all be TRUE:

```typescript
// Before rendering QR check-in form:
// 1. Session status = 'open' (not paused, not closed)
// 2. Doctor device is present in Supabase Realtime presence channel
// 3. Doctor's internet is connected (presence requires active WebSocket)

// If any condition is FALSE:
// Render: "Digital check-in is temporarily paused. Please wait."
```

### QR blind insert rule

When patient submits the QR form:
- NEVER confirm whether the mobile number already exists
- NEVER show "Welcome back, Rahul" — silent match only
- Render only: "You have been added to the queue. Please wait."
- Source set to `qr_kiosk`
- `identity_verified = FALSE`
- Doctor sees amber lock on this patient's card

### QR disabled conditions

- Session status = 'paused' or 'closed'
- Doctor device offline (presence channel disconnected)
- Clinic working hours config says clinic is closed (V2 feature)

---

## Identity Verification (Amber Lock)

When `source = 'qr_kiosk'` and `identity_verified = FALSE`:

```
┌─────────────────────────────────┐
│ ⚠️ UNVERIFIED CHECK-IN          │
│                                 │
│ Age: 45  Gender: Male           │
│ Last visit: 12-Jan-2025         │
│                                 │
│ [✓ Confirm Identity]  [⚠ Mismatch] │
└─────────────────────────────────┘

All medical input fields: disabled={true}
Cannot transition to IN_CONSULTATION until identity_verified = TRUE
```

**[Confirm Identity] clicked:**
```sql
UPDATE queue_entries
SET identity_verified = TRUE, version = version + 1
WHERE id = $id AND version = $currentVersion;
```

**[Mismatch / Imposter] clicked:**
```sql
-- RPC: unlink_and_isolate($queueEntryId, $clinicId)
-- 1. Creates new blank patient row
-- 2. Updates queue_entries.patient_id to new blank patient
-- 3. Old patient record untouched
-- Doctor now has a blank slate consultation for the imposter
```

---

## Doctor Portal Layout in Solo Mode

```
┌─────────────────────────────────────────────────────────┐
│ [Mobile/Name Input]  [+ Add Patient]     Session: OPEN  │
├─────────────────────────────────────────────────────────┤
│ Waiting (8)  |  A-03 Rahul Sharma — IN CONSULTATION     │
│ A-04 Priya   │                                          │
│ A-05 Ahmed   │  [Chief Complaint]                       │
│ A-06 Sunita  │  [Quick Notes]                           │
│ A-07 ...     │                                          │
│              │  [Mark Complete]  [Skip]  [No Show]      │
└─────────────────────────────────────────────────────────┘
```

Left sidebar = mini queue panel (replaces reception portal in solo mode).
Main area = active consultation.
No separate /reception route needed — all in /doctor for solo mode.
