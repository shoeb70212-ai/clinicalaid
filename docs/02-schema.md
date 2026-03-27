# Database Schema — V1

**Database:** PostgreSQL 15 via Supabase Managed Cloud Mumbai
**Rule:** Every table has clinic_id. Every RLS has USING + WITH CHECK.
**Run in order — each table depends on those above it.**

---

## Enums

```sql
CREATE TYPE staff_role     AS ENUM ('admin','doctor','receptionist');
CREATE TYPE session_status AS ENUM ('open','paused','closed');
CREATE TYPE clinic_mode    AS ENUM ('solo','team');
CREATE TYPE queue_status   AS ENUM (
  'CHECKED_IN','CALLED','IN_CONSULTATION',
  'COMPLETED','NO_SHOW','SKIPPED','CANCELLED'
);
CREATE TYPE queue_type     AS ENUM ('appointment','walk_in');
CREATE TYPE queue_source   AS ENUM ('reception','qr_kiosk','doctor_rapid');
CREATE TYPE payment_status AS ENUM ('pending','paid','waived');
CREATE TYPE payment_mode   AS ENUM ('cash','upi');
CREATE TYPE sync_status    AS ENUM ('synced','pending');
```

---

## 1. clinics

```sql
CREATE TABLE clinics (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  registration_no TEXT,
  clinic_mode     clinic_mode NOT NULL DEFAULT 'solo',
  primary_color   TEXT DEFAULT '#0ea5e9',   -- WCAG AA validated before save
  logo_url        TEXT,
  clinic_pin_code TEXT,                     -- V2 hook: outbreak radar
  config          JSONB DEFAULT '{
    "recall_engine_enabled": false,
    "drug_interactions_enabled": false,
    "consent_version": "v1.0",
    "avg_consultation_seconds": 300,
    "languages": ["en","hi"]
  }',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- No RLS on clinics — accessed during auth before clinic_id is set
-- Public read view for QR check-in (V2):
CREATE VIEW clinic_public_profiles AS
  SELECT id, name, address FROM clinics WHERE is_active = TRUE;
```

---

## 2. staff

```sql
CREATE TABLE staff (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        staff_role NOT NULL,
  specialty   TEXT,
  reg_number  TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_clinic ON staff(clinic_id);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_tenant ON staff
  USING (
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
    AND is_active = TRUE
  )
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 3. staff_invites

```sql
CREATE TABLE staff_invites (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        staff_role NOT NULL DEFAULT 'receptionist',
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  used_at     TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES staff(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invites_token  ON staff_invites(token);
CREATE INDEX idx_invites_clinic ON staff_invites(clinic_id);

ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invites_tenant ON staff_invites
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 4. consent_templates

```sql
CREATE TABLE consent_templates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id       UUID REFERENCES clinics(id) ON DELETE CASCADE, -- NULL = global default
  version         TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'en',
  content         TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_clinic ON consent_templates(clinic_id);

ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_tmpl_tenant ON consent_templates
  FOR SELECT USING (
    clinic_id IS NULL OR
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
  );
CREATE POLICY consent_tmpl_write ON consent_templates
  FOR ALL
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 5. patients

```sql
CREATE TABLE patients (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  dob             DATE,
  gender          TEXT CHECK (gender IN ('male','female','other','prefer_not_to_say')),
  mobile          TEXT NOT NULL,              -- NOT unique — families share phones
  address         TEXT,
  blood_group     TEXT,
  emergency_name  TEXT,
  emergency_phone TEXT,
  preferred_language TEXT DEFAULT 'en',
  abha_id         TEXT,                       -- V2 hook: ABHA integration
  is_anonymized   BOOLEAN DEFAULT FALSE,
  anonymized_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_patients_mobile ON patients(clinic_id, mobile);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_tenant ON patients
  USING (
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
    AND is_anonymized = FALSE
  )
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 6. patient_consents

```sql
CREATE TABLE patient_consents (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID NOT NULL REFERENCES patients(id),
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  consent_text     TEXT NOT NULL,
  consent_version  TEXT NOT NULL,
  consented_at     TIMESTAMPTZ DEFAULT NOW(),
  ip_address       TEXT,
  captured_by      UUID REFERENCES staff(id), -- NULL if self-served (V2 kiosk)
  is_withdrawn     BOOLEAN DEFAULT FALSE,
  withdrawn_at     TIMESTAMPTZ,
  withdrawn_by     UUID REFERENCES staff(id)
);

ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY consents_tenant ON patient_consents
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 7. sessions

```sql
CREATE TABLE sessions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  doctor_id   UUID NOT NULL REFERENCES staff(id),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  status      session_status DEFAULT 'open',
  opened_at   TIMESTAMPTZ DEFAULT NOW(),
  closed_at   TIMESTAMPTZ,
  avg_consultation_seconds INTEGER DEFAULT 300  -- updated on each COMPLETED transition
);

CREATE INDEX idx_sessions_clinic ON sessions(clinic_id, date);
CREATE INDEX idx_sessions_doctor ON sessions(doctor_id, date);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant ON sessions
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
```

---

## 8. session_counters (atomic token generation)

```sql
CREATE TABLE session_counters (
  session_id    UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  token_count   INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE session_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY counters_tenant ON session_counters
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 9. queue_entries (core table)

```sql
CREATE TABLE queue_entries (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id                UUID NOT NULL REFERENCES clinics(id),
  session_id               UUID NOT NULL REFERENCES sessions(id),
  patient_id               UUID NOT NULL REFERENCES patients(id),
  token_number             INTEGER NOT NULL,
  token_prefix             TEXT DEFAULT 'A',
  type                     queue_type NOT NULL DEFAULT 'walk_in',
  source                   queue_source NOT NULL DEFAULT 'reception',
  status                   queue_status NOT NULL DEFAULT 'CHECKED_IN',
  version                  INTEGER NOT NULL DEFAULT 1,
  identity_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  notes                    TEXT,
  sync_status              sync_status NOT NULL DEFAULT 'synced', -- V2 offline hook
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  called_at                TIMESTAMPTZ,                 -- set by DB trigger only
  consultation_started_at  TIMESTAMPTZ,                 -- set by DB trigger only
  completed_at             TIMESTAMPTZ                  -- set by DB trigger only
);

CREATE INDEX idx_qe_session ON queue_entries(session_id);
CREATE INDEX idx_qe_clinic  ON queue_entries(clinic_id);
CREATE INDEX idx_qe_status  ON queue_entries(session_id, status);

ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY qe_tenant ON queue_entries
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;
```

---

## 10. queue_display_sync (TV display — no PII)

```sql
CREATE TABLE queue_display_sync (
  session_id     UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  current_token  TEXT,
  next_token     TEXT,
  status         TEXT,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE queue_display_sync ENABLE ROW LEVEL SECURITY;
-- Display role can read — scoped JWT enforces clinic_id
CREATE POLICY display_read ON queue_display_sync
  FOR SELECT
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE queue_display_sync;
```

---

## 11. payments (basic V1 — cash/UPI flag only)

```sql
CREATE TABLE payments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id),
  patient_id     UUID NOT NULL REFERENCES patients(id),
  amount_paise   INTEGER NOT NULL DEFAULT 0,  -- always store in paise
  method         payment_mode NOT NULL DEFAULT 'cash',
  status         payment_status NOT NULL DEFAULT 'pending',
  collected_by   UUID REFERENCES staff(id),
  version        INTEGER NOT NULL DEFAULT 1,  -- OCC for concurrent marking
  -- V2 hooks (Razorpay):
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  paid_at        TIMESTAMPTZ
);

CREATE INDEX idx_payments_clinic  ON payments(clinic_id);
CREATE INDEX idx_payments_session ON payments(queue_entry_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON payments
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 12. master_drugs (global, read-only for clinics)

```sql
CREATE TABLE master_drugs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  generic_name TEXT,
  category     TEXT,
  schedule     TEXT,           -- H, H1, X, OTC
  is_banned    BOOLEAN DEFAULT FALSE,
  ban_date     DATE,
  ban_reason   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_drugs_name ON master_drugs USING gin(name gin_trgm_ops);
CREATE INDEX idx_drugs_banned ON master_drugs(is_banned) WHERE is_banned = TRUE;
-- Enable pg_trgm for fuzzy search:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Clinics can only read master_drugs — no RLS write policy:
ALTER TABLE master_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY drugs_read ON master_drugs FOR SELECT USING (TRUE);
```

---

## 13. doctor_drug_preferences

```sql
CREATE TABLE doctor_drug_preferences (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  doctor_id    UUID NOT NULL REFERENCES staff(id),
  drug_name    TEXT NOT NULL,
  generic_name TEXT,
  category     TEXT,
  usage_count  INTEGER NOT NULL DEFAULT 1,
  -- Most common dosage pattern (pre-fill defaults):
  default_dosage    TEXT,    -- e.g. '1-0-1'
  default_duration  INTEGER, -- days
  default_timing    TEXT,    -- 'after_food', 'before_food'
  is_from_master    BOOLEAN DEFAULT TRUE,
  master_drug_id    UUID REFERENCES master_drugs(id),
  sync_status       sync_status DEFAULT 'synced',
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ddp_doctor  ON doctor_drug_preferences(doctor_id);
CREATE INDEX idx_ddp_clinic  ON doctor_drug_preferences(clinic_id);
CREATE UNIQUE INDEX idx_ddp_unique ON doctor_drug_preferences(doctor_id, drug_name);

ALTER TABLE doctor_drug_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ddp_tenant ON doctor_drug_preferences
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 14. custom_clinic_drugs (sandbox — never touches master)

```sql
CREATE TABLE custom_clinic_drugs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  doctor_id    UUID REFERENCES staff(id),
  drug_name    TEXT NOT NULL,
  usage_count  INTEGER DEFAULT 1,
  flagged_for_review BOOLEAN DEFAULT FALSE, -- set when 50+ clinics add same drug
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_custom_clinic ON custom_clinic_drugs(clinic_id);

ALTER TABLE custom_clinic_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_drugs_tenant ON custom_clinic_drugs
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
```

---

## 15. drug_instructions_i18n (patient instruction translations)

```sql
CREATE TABLE drug_instructions_i18n (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dosage_code  TEXT NOT NULL,    -- e.g. '1-0-1', '0-0-1', 'SOS'
  timing_code  TEXT NOT NULL,    -- e.g. 'after_food', 'before_food', 'empty_stomach'
  language     TEXT NOT NULL,    -- e.g. 'hi', 'mr', 'ta', 'te', 'bn'
  instruction  TEXT NOT NULL,    -- e.g. 'सुबह और शाम, खाने के बाद'
  UNIQUE (dosage_code, timing_code, language)
);

-- Global table, no clinic_id — read-only for all
ALTER TABLE drug_instructions_i18n ENABLE ROW LEVEL SECURITY;
CREATE POLICY i18n_read ON drug_instructions_i18n FOR SELECT USING (TRUE);
```

---

## 16. audit_logs (append-only)

```sql
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  clinic_id   UUID NOT NULL,
  staff_id    UUID,           -- from JWT claims — never NULL for staff actions
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  old_value   JSONB,          -- PII columns excluded (name, mobile) — see trigger
  new_value   JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_clinic ON audit_logs(clinic_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (TRUE);
CREATE POLICY audit_read   ON audit_logs FOR SELECT
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
-- No UPDATE or DELETE policy — append-only enforced by omission
```

---

## V2 Hook Tables (schema only — no application code)

```sql
-- visits: full medical records (V2)
CREATE TABLE visits (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  patient_id       UUID NOT NULL REFERENCES patients(id),
  queue_entry_id   UUID REFERENCES queue_entries(id),
  doctor_id        UUID NOT NULL REFERENCES staff(id),
  visit_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  chief_complaint  TEXT,
  examination_notes TEXT,
  diagnosis        TEXT,
  icd10_code       TEXT,
  bp_systolic      INTEGER,
  bp_diastolic     INTEGER,
  pulse            INTEGER,
  temperature      NUMERIC(4,1),
  spo2             INTEGER,
  weight           NUMERIC(5,2),
  height           NUMERIC(5,2),
  follow_up_date   DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- appointments: booking system (V2)
CREATE TABLE appointments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  patient_id   UUID NOT NULL REFERENCES patients(id),
  doctor_id    UUID NOT NULL REFERENCES staff(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       TEXT DEFAULT 'booked',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- analytics_events: anonymised feed for V2 Intelligence VPS
CREATE TABLE analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,    -- 'consultation_completed', 'drug_prescribed'
  icd10_code   TEXT,
  drug_name    TEXT,
  pin_code     TEXT,             -- from clinics.clinic_pin_code
  specialty    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
  -- NO clinic_id, NO patient_id, NO staff_id — fully anonymous
);

-- kiosk_checkins: OTP kiosk flow (V2)
CREATE TABLE kiosk_checkins (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  mobile       TEXT NOT NULL,
  otp_hash     TEXT,
  verified_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Triggers

### 1. Timestamp trigger (BEFORE UPDATE on queue_entries)

```sql
CREATE OR REPLACE FUNCTION set_queue_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CALLED' AND OLD.status != 'CALLED' THEN
    NEW.called_at = NOW();
  END IF;
  IF NEW.status = 'IN_CONSULTATION' AND OLD.status != 'IN_CONSULTATION' THEN
    NEW.consultation_started_at = NOW();
  END IF;
  IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
    NEW.completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_timestamps
  BEFORE UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION set_queue_timestamps();
```

### 2. Audit trigger (AFTER UPDATE on queue_entries)

```sql
CREATE OR REPLACE FUNCTION log_queue_change()
RETURNS TRIGGER AS $$
DECLARE
  v_staff_id UUID;
  v_claims   JSONB;
BEGIN
  -- Read staff_id from JWT claims — no extra DB lookup needed
  v_claims   := current_setting('request.jwt.claims', true)::jsonb;
  v_staff_id := (v_claims ->> 'staff_id')::uuid;

  INSERT INTO audit_logs(
    clinic_id, staff_id, action, table_name, record_id,
    old_value, new_value
  )
  VALUES (
    NEW.clinic_id,
    v_staff_id,
    'QUEUE_STATUS_CHANGED',
    'queue_entries',
    NEW.id,
    -- Exclude PII columns from audit log (DPDP compliance)
    jsonb_build_object(
      'status',  OLD.status,
      'version', OLD.version,
      'token_number', OLD.token_number
    ),
    jsonb_build_object(
      'status',  NEW.status,
      'version', NEW.version,
      'token_number', NEW.token_number
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_audit
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION log_queue_change();
```

### 3. TV display sync trigger (AFTER UPDATE on queue_entries)

```sql
CREATE OR REPLACE FUNCTION sync_display()
RETURNS TRIGGER AS $$
DECLARE
  v_current TEXT;
  v_next    TEXT;
BEGIN
  -- Current = most recently CALLED token
  SELECT token_prefix || '-' || token_number INTO v_current
  FROM queue_entries
  WHERE session_id = NEW.session_id
    AND status = 'CALLED'
  ORDER BY called_at DESC LIMIT 1;

  -- Next = first CHECKED_IN token
  SELECT token_prefix || '-' || token_number INTO v_next
  FROM queue_entries
  WHERE session_id = NEW.session_id
    AND status = 'CHECKED_IN'
  ORDER BY created_at ASC LIMIT 1;

  INSERT INTO queue_display_sync(session_id, clinic_id, current_token, next_token, updated_at)
  VALUES (NEW.session_id, NEW.clinic_id, v_current, v_next, NOW())
  ON CONFLICT (session_id)
  DO UPDATE SET
    current_token = EXCLUDED.current_token,
    next_token    = EXCLUDED.next_token,
    updated_at    = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_display_sync
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION sync_display();
```

### 4. Average consultation time updater

```sql
CREATE OR REPLACE FUNCTION update_avg_consultation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status = 'IN_CONSULTATION'
     AND NEW.consultation_started_at IS NOT NULL THEN
    UPDATE sessions
    SET avg_consultation_seconds = (
      SELECT COALESCE(
        AVG(EXTRACT(EPOCH FROM (completed_at - consultation_started_at)))::INTEGER,
        300
      )
      FROM queue_entries
      WHERE session_id = NEW.session_id
        AND status = 'COMPLETED'
        AND consultation_started_at IS NOT NULL
    )
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_avg_consultation
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION update_avg_consultation();
```

---

## Key SQL Patterns

### Atomic token generation (no race condition)

```sql
-- Run inside a transaction
UPDATE session_counters
SET token_count = token_count + 1
WHERE session_id = $sessionId
RETURNING token_count;
-- Use returned token_count as the new token_number
```

### OCC queue update (every queue mutation)

```sql
UPDATE queue_entries
SET status = $newStatus, version = version + 1
WHERE id = $id AND version = $currentVersion
RETURNING *;
-- rows_affected = 0 → conflict → re-fetch → re-render silently
```

### Consent check (before every queue entry creation)

```sql
SELECT id FROM patient_consents
WHERE patient_id      = $patientId
  AND clinic_id       = $clinicId
  AND consent_version = (SELECT config->>'consent_version' FROM clinics WHERE id = $clinicId)
  AND is_withdrawn    = FALSE
ORDER BY consented_at DESC LIMIT 1;
-- 0 rows → must show consent before proceeding
```

### Mobile lookup (always returns array — families share phones)

```sql
SELECT id, name, dob, gender FROM patients
WHERE clinic_id = $clinicId
  AND mobile    = $mobile
  AND is_anonymized = FALSE
ORDER BY created_at ASC;
-- Return array to UI — never auto-select
```

### Patient anonymization (DPDP erasure)

```sql
UPDATE patients SET
  name            = '[ANONYMIZED]',
  mobile          = encode(digest(mobile, 'sha256'), 'hex'),
  dob             = NULL,
  address         = NULL,
  blood_group     = NULL,
  emergency_name  = NULL,
  emergency_phone = NULL,
  is_anonymized   = TRUE,
  anonymized_at   = NOW()
WHERE id = $patientId AND clinic_id = $clinicId;
```

### Z-Report (end of day)

```sql
SELECT
  COUNT(*)                                         AS total_patients,
  COUNT(*) FILTER (WHERE status = 'COMPLETED')     AS completed,
  COUNT(*) FILTER (WHERE status = 'NO_SHOW')       AS no_shows,
  SUM(p.amount_paise) FILTER (WHERE p.method = 'cash' AND p.status = 'paid') AS cash_paise,
  SUM(p.amount_paise) FILTER (WHERE p.method = 'upi'  AND p.status = 'paid') AS upi_paise
FROM queue_entries qe
LEFT JOIN payments p ON p.queue_entry_id = qe.id
WHERE qe.session_id = $sessionId;
```

### Patient data export (DPDP Section 11)

```sql
-- RPC: export_patient_data($patientId)
SELECT
  p.*,
  json_agg(DISTINCT pc.*) AS consents,
  json_agg(DISTINCT qe.*) AS queue_history
FROM patients p
LEFT JOIN patient_consents pc ON pc.patient_id = p.id
LEFT JOIN queue_entries    qe ON qe.patient_id = p.id
WHERE p.id = $patientId
GROUP BY p.id;
```
