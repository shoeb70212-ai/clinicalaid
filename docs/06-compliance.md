# Legal Compliance — Hard Limits

Rules that cannot be broken under any circumstances.
Each maps to a specific Indian law with penalty stated.

---

## HARD LIMITS — Never Violate

### 1. Never hard-delete a patient row
**Law:** NMC Guidelines + CEA 2010
**Rule:** `DELETE FROM patients` is illegal if patient has records < 3 years old.
Always use anonymization pattern. No exceptions. No dev shortcuts.
**Penalty:** NMC disciplinary action. Clinic de-registration.

### 2. Never collect or store Aadhaar numbers
**Law:** Aadhaar Act 2016, Section 29
**Rule:** Not a UIDAI Authorized User Entity. Even last 4 digits is legally ambiguous.
Identity combination = mobile number + date of birth. Period.
**Penalty:** Imprisonment up to 3 years.

### 3. Never write patient data before consent is recorded
**Law:** DPDP Act 2023, Section 6
**Rule:** patient_consents row must be created in same transaction as patients row.
If patient has withdrawn consent, block check-in until new consent given.
**Penalty:** Up to ₹50 crore per violation.

### 4. Never transfer patient data outside India
**Law:** DPDP Act 2023, Section 17
**Rule:** All data stays on Supabase Managed Mumbai (ap-south-1).
Sentry error tracking: scrub all PII before transmission.
No Google Analytics, Mixpanel, or any tool that receives patient PII.
**Penalty:** Up to ₹250 crore per violation.

### 5. Never build drug interaction alerts or AI diagnostics
**Law:** CDSCO SaMD framework
**Rule:** Clinical decision support = SaMD classification = CDSCO approval required.
Queue management + records + prescriptions = safe.
Drug interaction hard blocks, AI diagnosis, risk scoring = regulatory seizure risk.
Any future developer must read this before adding features.
**Penalty:** Regulatory seizure, criminal prosecution.

### 6. Never allow Schedule X drugs in digital prescription (V2 when prescriptions built)
**Law:** Drugs and Cosmetics Act 1940
**Rule:** Narcotics + psychotropics require physical prescription pad.
`schedule = 'X'` on master_drugs triggers hard UI block.
Cannot be bypassed. Log every attempt.
**Penalty:** Criminal prosecution.

---

## DPDP Act 2023 — Key Obligations

| Section | Obligation | Implementation |
|---|---|---|
| Sec 4 | Process data only for lawful purpose with consent | Consent check before every queue entry |
| Sec 6 | Consent: free, specific, informed, unconditional | Full consent text — not a checkbox |
| Sec 8 | Technical + organizational security measures | RLS, encryption, audit logs, HTTPS |
| Sec 11 | Patient right to summary of data processed | `export_patient_data` RPC |
| Sec 12 | Patient right to correction and erasure | Anonymization pattern |
| Sec 17 | No cross-border data transfer | Supabase Mumbai only |
| Sec 33 | Penalty | Up to ₹250 crore breach / ₹50 crore consent violation |

---

## Consent Text — Minimum Required Content

All 7 items below must appear in the consent text shown to patients.
A generic "I agree to terms" checkbox does NOT satisfy DPDP Section 6.

1. **Data Fiduciary identity:** clinic name and address
2. **Data categories:** name, DOB, gender, mobile, address, health records, visit notes
3. **Purpose:** to manage clinic appointment and maintain medical records
4. **Retention period:** medical records kept for minimum 7 years from last visit
5. **Who has access:** doctor, receptionist, clinic administrative staff
6. **Patient rights:** access a copy, correct inaccuracies, request erasure of PII
7. **Withdrawal:** how to withdraw consent (contact clinic or visit settings page)

---

## Patient Anonymization (DPDP erasure — never hard delete)

```sql
-- Run when patient invokes DPDP Section 12 erasure right
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

**Guards before running anonymization:**
- Check last visit date. If < 3 years: PII can be anonymized, visit records cannot be touched.
- After anonymization: patient excluded from all queries via RLS `AND is_anonymized = FALSE`
- Mark all patient_consents as withdrawn

**What is retained:** queue_entries (audit trail), clinical data structure (NMC)
**What is destroyed:** name, mobile, dob, address, blood_group, emergency contacts

**V2 addition (when PDFs exist):**
Physical PDF files at `{clinic_id}/prescriptions/{patient_id}/` must be hard-deleted
from Supabase Storage. DB clinical records retained. Files with PII destroyed. (Path B)

---

## Medical Record Retention

| Requirement | Source | Duration |
|---|---|---|
| Minimum | NMC / MCI | 3 years from last visit |
| Recommended | NMC practice | 7 years |
| Maharashtra | CEA 2018 | 5 years |
| Build for | ClinicFlow | 7 years (safest) |

---

## Audit Log PII Policy

The queue_entries audit trigger explicitly excludes PII columns from old_value/new_value.
Only operational fields logged: status, version, token_number.

This prevents audit_logs from retaining PII after patient anonymization.
If an audit is needed for medico-legal purposes, the structural queue record is retained.
The patient's name is not in the audit log — by design.

---

## Re-Identification After Anonymization

If an anonymized patient returns to the clinic, the receptionist cannot find their old
record (RLS hides anonymized rows). A new patient record will be created.

This is intentional — the patient requested erasure. Creating a new record does not
fracture clinical continuity in a legally problematic way because the old record's
clinical data (visit structure) is retained for NMC compliance under the anonymized UUID.

Do NOT build a re-identification flow. It would defeat the purpose of anonymization
and violate DPDP Section 12.

---

## Staff Confidentiality

**IT Act 2008, Section 72A:** Unauthorized disclosure = criminal offence.

Every staff member must sign a data confidentiality agreement before system access.
Track via admin onboarding checklist — not a code requirement.
The audit log is your defense in any disclosure dispute.

---

## SaMD Safe Harbour — What Keeps ClinicFlow Outside Regulatory Scope

**Safe (no CDSCO approval needed):**
- Queue management
- Patient registration and basic profile
- Visit notes (free text)
- Prescription recording (V2)
- Statistical suggestion chips (Apriori — read-only, human approves)

**Triggers SaMD classification (never build without CDSCO review):**
- Drug interaction hard blocks presented as clinical warnings
- AI-generated diagnosis suggestions written to patient record
- Clinical risk scores
- Automated triage
- Differential diagnosis AI with write path to patient record

If you are ever unsure whether a new feature crosses this line — it does.
Consult a regulatory expert before building it.

---

## Legal Quick Reference

| Law | Obligation | Penalty |
|---|---|---|
| DPDP Act 2023 | Consent, erasure, residency, breach notification | Up to ₹250 crore |
| IT Act 2000 Sec 43A | Reasonable security practices | Up to ₹5 crore |
| IT Act 2008 Sec 72A | No unauthorized disclosure | Imprisonment up to 3 years |
| NMC Guidelines | Records 7 years, prescription format, NMC number | Disciplinary action |
| Drugs & Cosmetics Act 1940 | Schedule H/H1 prescription, Schedule X physical only | Criminal prosecution |
| Aadhaar Act 2016 | No Aadhaar collection without UIDAI auth | Imprisonment up to 3 years |
| CEA 2010 | State-specific registration and record formats | Clinic de-registration |
| CDSCO SaMD | Clinical decision support = regulatory approval needed | Seizure, prosecution |
