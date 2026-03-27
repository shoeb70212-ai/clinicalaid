# V2 Roadmap

This document defines everything deferred from V1.
Read this before starting any V2 feature to understand dependencies and sequence.
V2 only begins after V1 is stable in production with at least one paying clinic.

---

## V2 Prerequisites (must be true before V2 starts)

- [ ] V1 is in production with at least one clinic using it daily
- [ ] Zero critical bugs in queue state machine
- [ ] OCC conflict rate < 1% (monitored via Sentry)
- [ ] All 15 Definition of Done tests passing in production
- [ ] Database has real usage patterns for drug starter pack improvement

---

## V2 Feature Set

### 1. Full Medical Records (visits table)

**Depends on:** Stable V1 queue (queue_entry_id links to visit)
**Schema:** `visits` table already defined in V1 schema — activate in V2
**Builds:**
- Chief complaint, examination notes, diagnosis (structured, not just notes field)
- ICD-10 code autocomplete
- Vitals as structured columns (BP, pulse, temp, SpO2, weight, height, BMI auto-calc)
- Follow-up date scheduling
- Referral notes
- Full visit history timeline in patient profile (replaces quick notes in Column 3)

**Migration from V1:** `queue_entries.notes` field data can be migrated to
`visits.examination_notes` as a one-time script. No data loss.

---

### 2. Prescription PDF Generation

**Depends on:** visits table (V2 feature above)
**Spec:** See docs/10-pdf-prescriptions.md (full spec written, not implemented)
**Builds:**
- `@react-pdf/renderer` client-side PDF generation
- 3 prescription templates (Modern Sidebar, Classic Header, Minimal)
- Doctor signature SVG injection (doctor auth only)
- NMC-compliant field set (all 10 mandatory fields)
- Schedule X hard block
- Web Share API for WhatsApp/print (no WhatsApp Business API)
- PDF storage: `{clinic_id}/prescriptions/{patient_id}/{visit_id}.pdf`
- Patient instruction in regional language (drug_instructions_i18n already seeded in V1)

---

### 3. Patient OTP Kiosk (/kiosk)

**Depends on:** MSG91 DLT registration (start immediately — takes 2–3 business days)
**Schema:** `kiosk_checkins` table already defined in V1 schema
**Builds:**
- MSG91 DLT registration (start before coding anything)
- Mobile number entry + 6-digit OTP (custom digit pad, not browser keyboard)
- Consent display (scroll-to-bottom gate before I Agree activates)
- New patient registration form (name, DOB, gender — minimal)
- Returning patient auto-fill and family selection
- Session selection (multi-doctor clinics)
- Token issuance screen with large font
- Auto-reset kiosk after 2 minutes inactivity
- `source = 'qr_kiosk'` + `identity_verified = FALSE` → amber lock in doctor portal

**DLT templates to register:**
```
OTP:   "Your ClinicFlow check-in OTP is {#var#}. Valid for 5 minutes."
Token: "You have checked in at {#var#}. Your token is {#var#}. Wait: ~{#var#} min."
```

---

### 4. Appointment Booking System

**Depends on:** Stable V1 queue
**Schema:** `appointments` table already defined in V1 schema
**Builds:**
- Per-doctor calendar with configurable slot durations
- Walk-in + appointment queue merge logic:
  - Appointments get priority position at scheduled time
  - Walk-ins fill gaps between appointment slots
  - Token prefix distinguishes: A-01 (appointment) vs W-01 (walk-in) — configurable
- Waitlist when slots full
- Follow-up scheduling (links from visit record in medical records)

---

### 5. Razorpay Payments

**Depends on:** Stable V1 basic payments (cash/UPI flag already in schema)
**Builds:**
- Razorpay account KYC (complete before coding)
- Online payment flow: Order creation → UPI Intent → webhook verification
- Webhook handler: HMAC-SHA256 signature verification before any DB update
- Payment link via SMS (MSG91 — requires DLT registration)
- Cash OCC marking (already designed — activate Razorpay columns in payments table)
- Refund flow: auto-refund on clinic-initiated cancellation
- Z-Report: upgrade from V1 basic count to full revenue breakdown with Razorpay settlements

---

### 6. SMS / WhatsApp Notifications

**Depends on:** MSG91 DLT registration (same as kiosk)
**Builds:**
- Appointment reminder: 24h before + 2h before
- Token confirmation SMS on check-in
- Queue position update (optional — configurable per clinic)
- WhatsApp prescription delivery (requires Meta Business approval — apply early)

**DLT templates to register:**
```
Reminder: "Reminder: Your appointment at {#var#} is tomorrow at {#var#}."
Token:    "Check-in confirmed at {#var#}. Token: {#var#}. Est. wait: {#var#} min."
```

---

### 7. Voice-to-Text (Whisper Local)

**Depends on:** Native wrapper (Capacitor/Tauri)
**Implementation:** Transformers.js + quantized Whisper model (whisper-tiny)
**Builds:**
- Model downloads on first app launch (~40MB, cached)
- Microphone button in consultation screen (Chief Complaint + Quick Notes fields)
- Audio recorded via MediaRecorder API
- Whisper processes locally on device CPU — zero network call
- Text output streams into active field
- DPDP compliant: audio never leaves device

**Note:** Runs on device CPU. 1–3 second transcription delay on low-end Android.
Performance acceptable for dictating a sentence at a time, not continuous stream.

---

### 8. OCR Lab Report Scanning

**Depends on:** Native wrapper (camera access) + visits table
**Implementation:** Tesseract.js (WASM — runs locally on device)
**Builds:**
- Camera button in visit record screen
- Photo captured via native camera API
- Tesseract processes image locally — zero API call
- Key-value extraction: maps recognized text to vitals fields
- Doctor reviews + confirms extracted values before save
- DPDP compliant: image never leaves device

---

### 9. Patient Recall Engine

**Depends on:** Full medical records (visits table) + chronic medication tracking
**Builds:**
- Background worker: queries patients with chronic medication expiring in 48 hours
- "Recall List" on doctor dashboard: patients due for follow-up
- Native SMS URI scheme: opens doctor's SMS app pre-filled with reminder in patient's language
- Zero MSG91 cost: uses doctor's personal carrier plan
- Configurable: enable per clinic via `recall_engine_enabled` flag in clinics.config

---

### 10. Native Wrapper (Android / iOS / Desktop)

**Depends on:** Stable V2 feature set
**Framework recommendation:** Capacitor (wraps existing React codebase)
**Desktop:** Tauri (Rust-based, smaller binary than Electron)

**What native unlocks:**
- SQLite (SQLCipher encrypted) for true offline-first with pending sync queue
- Background sync on reconnect (no manual refresh needed)
- Camera API for OCR
- Microphone API for voice-to-text (though Web API works in modern browsers too)
- Push notifications for appointment reminders

**V1 → V2 migration:** PWA already works on all devices. Native wrapper is an upgrade,
not a replacement. Clinics using PWA can continue using PWA. Native app is optional.

---

### 11. Intelligence VPS (AI Layer)

**Depends on:** 6+ months of production data from multiple clinics
**Infrastructure:** Separate E2E Networks Mumbai VM (GPU node — NVIDIA T4 or L4)
**Air gap:** VPS never connects to Supabase. Receives only anonymised weekly batch.

**What it receives (anonymised, no PII):**
```
analytics_events: event_type, icd10_code, drug_name, pin_code, specialty, timestamp
```

**Features:**
- Outbreak radar: spike detection in ICD-10 codes by pin code
  - "300% rise in J01.9 (sinusitis) in your area this week"
  - Displayed as informational widget — not a clinical alert
- Dynamic pharmacovigilance: daily CDSCO scraper for banned drug updates
  - Pushes updates to master_drugs automatically
  - Faster than manual ClinicFlow team updates
- Drug catalog reconciliation: LLM batch job (weekly, anonymised custom drug strings)
  - Groups typo variants → flags for admin approval → adds to master_drugs
  - Cost: < $1/month using Anthropic Claude Haiku or Google Gemini Flash
- Specialty starter pack improvement: statistical clustering of drug usage patterns
  - Improves onboarding starter packs as real usage data accumulates
- Sandbox co-pilot (optional, doctor-initiated):
  - Separate tab in consultation screen (NOT connected to patient record)
  - Doctor types anonymous symptom description
  - VPS returns differential diagnosis suggestions as read-only text
  - No write path from VPS to patient record — architecturally impossible

**SaMD boundary:** All VPS outputs are informational only. No write path to patient records.
Any VPS feature that creates a write path to clinical data triggers SaMD classification.
Do not build it.

---

### 12. ABHA Integration

**Depends on:** ABDM sandbox registration (apply at abdm.gov.in)
**Column:** `patients.abha_id` already in V1 schema
**Builds:**
- ABHA QR scan at check-in: patient shows ABHA QR, clinic scans and links
- Pulls verified name + DOB from ABDM — eliminates identity spoofing concern
- Linked health records can be shared with ABHA network (patient's choice)
- Replaces mobile+DOB as identity combination for consented patients

---

### 13. Patient Portal (/patient)

**Depends on:** Full medical records + ABHA (optional)
**Builds:**
- Mobile OTP login (MSG91 — same DLT registration)
- View own visit history and prescriptions
- Download prescription PDFs (signed URL, time-limited)
- Update contact details
- Consent management: view, withdraw, re-consent
- DPDP Section 11: data export request button

---

### 14. Analytics + Reporting

**Depends on:** 3+ months of production data
**Builds:**
- Daily / weekly / monthly patient counts
- Doctor-wise stats (consultations per hour, average duration)
- Peak hour analysis
- No-show rate
- Drug usage patterns (anonymised, clinic-level)
- Revenue reports (after Razorpay integration)
- Export as CSV

---

## V2 Build Sequence

Build in this order. Each phase is a stable release:

```
Phase 2.1 → Medical records (visits table) + prescription PDF
Phase 2.2 → OTP Kiosk + MSG91 DLT registration
Phase 2.3 → Appointment booking system
Phase 2.4 → Razorpay payments + refund flow
Phase 2.5 → SMS/WhatsApp notifications
Phase 2.6 → Voice-to-text + OCR (requires native wrapper)
Phase 2.7 → Patient recall engine
Phase 2.8 → Intelligence VPS (requires 6 months data)
Phase 2.9 → Native wrapper (Android, iOS, Desktop)
Phase 2.10 → ABHA integration
Phase 2.11 → Patient portal
Phase 2.12 → Full analytics dashboard
```

---

## V2 External Dependencies Checklist

Start these in parallel with late V1 — they have approval wait times:

| Dependency | Lead Time | Start When |
|---|---|---|
| MSG91 DLT registration | 2–3 business days | As soon as V1 is stable |
| Razorpay KYC | 3–5 business days | Before Phase 2.4 |
| WhatsApp Business API (Meta) | 2–4 weeks | Before Phase 2.5 |
| ABDM sandbox access | 1–2 weeks | Before Phase 2.10 |
| CDSCO SaMD consultation | If triggered | Before any AI diagnostic feature |
| E2E GPU node provisioning | 1–2 days | Before Phase 2.8 |
| VAPT audit (CERT-In empanelled) | 2–4 weeks, ₹25K–60K | Before onboarding paying clinics |
