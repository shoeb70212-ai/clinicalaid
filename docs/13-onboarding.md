# Onboarding Wizard — V1

Target: onboarding completed in under 3 minutes.
If it takes longer, a doctor will abandon the software.

---

## Setup Wizard Route: /setup

Unauthenticated. First-run only.
After completion, redirect to /doctor (solo mode) or /reception + /doctor (team mode).
Do not show /setup if `clinics` record already exists for this account.

---

## Step 1: Doctor Account Creation

**Fields:**
- Full name (required)
- Email (required — used for Supabase Auth login)
- Password (required — min 8 chars, one number)
- Mobile number (required — email OTP fallback if password forgotten)
- Medical Registration Number — NMC reg (required for V2 prescriptions, collect now)
- Qualification — MBBS / MD / MS / BDS / etc. (required for prescription header in V2)
- Specialty — dropdown (required — drives starter pack injection)

**Email verification:**
Supabase sends verification email automatically on account creation.
Doctor must verify before onboarding continues.
No SMS OTP at this step — email only. No external API dependency.

**NMC number format validation:**
State code prefix + numeric string. Validate format client-side.
Store in `staff.reg_number`. Do not validate against NMC registry in V1.

---

## Step 2: Clinic Details

**Fields:**
- Clinic name (required)
- Address (required)
- Phone number (required)
- State (required — drives CEA compliance notes in V2)
- Pin code (required — stored in `clinics.clinic_pin_code` for V2 outbreak radar)
- GST number (optional — for V2 billing)

**Logo upload:**
Optional at this step. Can be done later in settings.
If uploaded: saved to `{clinic_id}/logos/logo.{ext}` in Supabase Storage.
MIME: JPG/PNG/WebP only. Max 2MB. WCAG contrast not applicable to logo.

**Brand colour picker:**
- Show 12 curated preset colours (safe WCAG AA combinations pre-verified)
- Option to enter custom hex code
- On custom hex input: validate WCAG AA contrast against white (#FFFFFF) in real-time
- Reject with explanation if contrast ratio < 4.5:1
- Default: #0ea5e9 (Tailwind sky-500 — safe blue)

---

## Step 3: Clinic Mode Selection

```
How do you run your clinic?

┌─────────────────────────┐  ┌─────────────────────────┐
│  👨‍⚕️ Just Me            │  │  👥 With a Receptionist  │
│                         │  │                          │
│  I handle everything    │  │  I have staff who        │
│  myself. No reception   │  │  manage the queue        │
│  staff.                 │  │  for me.                 │
│                         │  │                          │
│  Best for: solo GP,     │  │  Best for: polyclinic,   │
│  neighborhood clinic    │  │  specialty clinic        │
└─────────────────────────┘  └─────────────────────────┘
```

Sets `clinics.clinic_mode = 'solo'` or `'team'`.
This cannot be changed easily after patients exist — warn clearly.

---

## Step 4a: Solo Mode — QR Code Generation

If `clinic_mode = 'solo'`:
- Session counter record auto-created
- QR code generated immediately pointing to: `https://app.clinicflow.in/qr/{clinic_id}`
- Show QR code with print button: "Print this and stick it in your waiting area"
- Explain QR flow in 2 sentences: "Patients scan this to join your queue. They appear on your screen automatically."
- Doctor can skip if they prefer to add patients manually

---

## Step 4b: Team Mode — Staff Invite

If `clinic_mode = 'team'`:
- Show invite form: receptionist email
- On submit: create `staff_invites` record, send invite email with link
- Email subject: "You've been invited to manage [Clinic Name] on ClinicFlow"
- Email body: invite link + expiry (48 hours) + simple instructions
- Doctor can send multiple invites (one per staff member)
- Can skip and send later from settings

**Invite link format:**
```
https://app.clinicflow.in/invite?token={secure_random_token}
```

**Receptionist onboarding via invite link:**
1. Opens link → sees clinic name pre-filled
2. Enters name + password (email locked from invite record)
3. Supabase Auth creates user
4. Staff row created: `clinic_id` from invite, `role = 'receptionist'`
5. `staff_invites.used_at = NOW()`
6. JWT enrichment fires on first login

---

## Step 5: Specialty Drug Batch Injection

After specialty is confirmed in Step 1:
```typescript
// Runs immediately after clinic creation
await supabase.rpc('seed_doctor_drug_batch', {
  doctor_id: staffId,
  clinic_id: clinicId,
  specialty:  doctorSpecialty,
});
```

This populates `doctor_drug_prefs` with top 150 drugs for their specialty.
Happens in background — doctor does not wait for it.
Progress: "Personalising your drug library... done ✓"

---

## Step 6: First Value Delivery (Demo Patient)

Final onboarding step: drop doctor into a live consultation immediately.

```
┌─────────────────────────────────────────┐
│ 🎉 You're all set!                      │
│                                         │
│ We've added a test patient to your      │
│ queue so you can try ClinicFlow right   │
│ now.                                    │
│                                         │
│ [Start your first consultation →]       │
│                                         │
│ [Skip — I'll add a real patient]        │
└─────────────────────────────────────────┘
```

**Demo patient rules:**
- Created entirely in frontend state — NEVER written to the database
- Name: "Test Patient"
- All form fields work normally
- [Mark Complete] button: clears demo and shows real queue (empty)
- No audit log created for demo patient actions
- No consent captured (demo is ephemeral, not a real patient)

---

## Consent Template Seeding

On clinic creation, seed a default consent record:

```sql
INSERT INTO consent_templates(clinic_id, version, language, content, is_active)
VALUES
  ($clinicId, 'v1.0', 'en', $defaultEnglishConsentText, TRUE),
  ($clinicId, 'v1.0', 'hi', $defaultHindiConsentText,   TRUE);
```

Default text provided by ClinicFlow (satisfies all 7 DPDP requirements).
Clinic can customise from settings after onboarding.
Customisation creates a new version (v1.1) — does not overwrite v1.0.

---

## Post-Onboarding Settings (accessible later)

These are NOT shown in the onboarding wizard to reduce friction.
Available in clinic settings after first login:

- Working hours configuration
- Languages offered to patients (drives QR form language options)
- SMS notifications toggle (V2 — disabled in V1)
- Consent text customisation
- Additional staff invites
- Prescription template selection (V2)
- TV display PIN generation

---

## Onboarding Data Flow Summary

```
Step 1: Create auth.users + staff row + JWT enrichment hook fires
Step 2: Create clinics row + storage bucket folder initialised
Step 3: Set clinic_mode on clinics row
Step 4a(solo):  session_counters seeded + QR URL generated
Step 4b(team):  staff_invites row created + invite email sent
Step 5:         doctor_drug_prefs seeded from specialty_starter_packs
Step 6:         Redirect to /doctor — ephemeral demo patient in frontend state
```

All steps except Step 5 (background) complete synchronously.
Total clock time: under 3 minutes for a doctor who reads normally.
