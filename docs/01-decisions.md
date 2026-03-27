# Architecture Decisions (Locked)

8 locked decisions. Read every one before writing related code.
Each includes its V2 implication so future development does not contradict the foundation.

---

## Decision 1: Multi-Tenant via clinic_id on Every Table

Every table carries `clinic_id UUID NOT NULL REFERENCES clinics(id)`.
Every RLS policy enforces both read isolation (USING) and write isolation (WITH CHECK).

```sql
USING     (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
WITH CHECK(clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
```

Adding clinic_id on Day 1 costs 2 hours.
Retrofitting it onto a live production database costs weeks of risky migration.
Even if this stays single-clinic forever, the column costs nothing.

**What this prevents:** Two clinics can never see each other's data — not because the
application checks, but because the database engine physically prevents it at the row level.
Even a bug that omits a WHERE clause cannot leak data across tenants.

**V2 implication:** Intelligence VPS receives ONLY anonymised, clinic_id-stripped data.
The clinic_id never leaves the main Supabase instance.

---

## Decision 2: Optimistic Concurrency Control on queue_entries

`queue_entries` has `version INTEGER NOT NULL DEFAULT 1`.
Every UPDATE must follow this exact pattern:

```sql
UPDATE queue_entries
SET status = $newStatus, version = version + 1
WHERE id = $id AND version = $currentVersion
RETURNING *;
```

`rows_affected = 0` = conflict. Re-fetch. Re-render. Never show error to user.

Doctor portal has soft priority: shorter network timeout than reception.
First write to arrive wins. No distributed locks. No deadlocks.

**V2 implication:** `appointments` and `payments` tables also get version column + OCC.
Same helper (`src/lib/occ.ts`), same pattern.

---

## Decision 3: Soft Delete — Cryptographic Anonymization Only

No `DELETE FROM patients` ever. Erasure = PII destruction, not row deletion.

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

**Why:** DPDP Act 2023 Section 12 (right to erasure) vs NMC (retain records 7 years).
Both laws satisfied: PII destroyed (DPDP), clinical structure retained (NMC).

Anonymization blocked if last visit < 3 years ago (NMC hard floor).
PII can be anonymized at any time. Visit records cannot be touched for 3 years.

**V2 implication:** When prescription PDFs exist, physical files under
`{clinic_id}/prescriptions/{patient_id}/` are hard-deleted from Storage on erasure.
Database clinical records are retained. Files containing PII are not. This is Path B.

---

## Decision 4: DPDP Consent Captured in Same Transaction as Patient Row

`patient_consents` and `patients` rows created in one atomic DB transaction.

```sql
-- One transaction:
-- Step 1: INSERT INTO patients → returns patient_id
-- Step 2: INSERT INTO patient_consents using that patient_id
-- If either fails: both roll back. No partial state.
```

**Why:** patient_consents.patient_id is NOT NULL FK. Creating consent first breaks FK.
Creating patient first breaks DPDP Section 6. Transaction resolves circular dependency.

**Minimum consent text must include:**
1. Clinic name and address
2. Categories of data collected
3. Purpose of collection
4. Retention period (7 years minimum)
5. Who has access
6. Patient rights: access, correct, erase
7. How to withdraw consent

A checkbox saying "I agree to terms" does not satisfy DPDP Section 6.

**Consent versioning:** When text is updated, version increments (v1.0 → v1.1).
On next check-in, if patient's last consent is older version, new consent required.
`consent_templates` table stores global default + per-clinic override.

**V2 implication:** OTP kiosk patients capture consent on their own device.
`captured_by` = NULL (self-served) vs staff_id (receptionist on behalf).
Same `patient_consents` table — no schema change needed.

---

## Decision 5: Supabase Managed Cloud Mumbai as Single Backend

Supabase Managed Cloud, region ap-south-1 (Mumbai). Not self-hosted.

| Risk | Self-Hosted | Managed |
|---|---|---|
| Point-in-time recovery | Manual WAL config | Built-in 7-day PITR |
| Security patches | Manual per container | Automatic |
| VM crash during OPD | Clinic stops | HA by default |
| Edge Functions | Manual Deno setup | Built-in |
| Realtime at scale | Single VM choke | Managed cluster |

Mumbai region satisfies DPDP Indian data residency requirement.
Lock-in is the SDK, not the database. Eject to raw PostgreSQL anytime — zero data migration.

**Why not Firebase:** Firestore is NoSQL. Medical records are deeply relational.
NoSQL denormalization creates silent data integrity errors. Firebase charges per document
read — live queue TV display generates millions of reads daily, unpredictable billing.

**V2 implication:** Intelligence VPS is a separate E2E Networks Mumbai server.
It never connects to Supabase directly. Data flows one-way via anonymised weekly batch.
VPS has its own database — zero PII.

---

## Decision 6: Clinic Mode Flag Drives All UI Branching

`clinic_mode ENUM('solo','team')` on `clinics` table. Set at onboarding. Changeable later.

```
SOLO → Rapid mode. No reception portal. QR auto-generated. Doctor handles patient add.
TEAM → Standard queue. Reception portal active. Staff invite required.
```

**What clinic_mode controls at runtime:**
- Which portals are accessible
- Whether QR check-in is auto-provisioned
- Whether staff invite flow appears in onboarding
- Rapid mode RPC availability
- TV display provisioning

**What clinic_mode does NOT change:**
- Database schema (same tables for both)
- RLS policies (same isolation for both)
- OCC (same pattern, fewer conflicts in solo)
- Compliance rules (same DPDP, NMC for both)

**V2 implication:** Third mode `MULTI_DOCTOR` for polyclinics with multiple doctors,
shared reception, separate queues with token prefixes (A-07, B-03).
`sessions` table already supports this — UI just needs a new case in the mode switch.

---

## Decision 7: 3-Tier Drug Database

```
Tier 1: master_drugs          Cloud only, read-only. Maintained by ClinicFlow team.
Tier 2: doctor_drug_prefs     Per-doctor batch. Cloud + local SQLite sync.
Tier 3: custom_clinic_drugs   Per-clinic sandbox. Never touches master.
```

300,000+ Indian drug SKUs cannot be downloaded to a phone.
A doctor's actual universe is 100-200 drugs.
Allowing writes to master_drugs creates typo pollution immediately.

**How tiers interact:**
1. Search hits local batch first (offline, <1ms)
2. Miss + online → hits master_drugs cloud (pg_trgm fuzzy search)
3. Doctor selects from master → copied to local batch for future offline use
4. Not in master → typed as custom → saved to clinic sandbox only
5. Weekly: if 50+ clinics add same custom drug → flagged for admin approval → added to master

**Suggestions are read-only.** Chips appear — doctor taps to accept.
Pre-filled dosage highlighted soft blue — doctor clicks Add to confirm.
Nothing auto-applied to prescription. Ever.

**CDSCO banned drug enforcement:** `is_banned`, `ban_date`, `ban_reason` on master_drugs.
Hard UI block fires on selection — cannot be bypassed.

**V2 implication:** Semantic vector search (all-MiniLM-L6-v2) on Intelligence VPS.
"Acid reflux" returns Pantoprazole without exact text match.
Zero change to Tier 2 or Tier 3 — only master search improves.

---

## Decision 8: Read-Only AI — Suggest Only, Human Approves All

No AI makes any change to any record, prescription, or patient data.
AI surfaces suggestions as tappable chips or pre-filled (highlighted) fields.
Doctor must explicitly tap or click to accept. Ignoring = no effect.

**Why:** Auto-writing to a prescription = Clinical Decision Support System (CDSS).
CDSS = CDSCO Software as Medical Device (SaMD) classification.
SaMD requires regulatory approval before launch.
Read-only AI bypasses this classification entirely.

**What AI can do in V1 (statistical, no LLM):**
- Pre-fill dosage fields based on doctor's historical mode (soft blue highlight)
- Show "usually prescribed with" chips via Apriori association mining
- Drug reconciliation notification ("Did you mean ZainCure 500mg?")

**What AI can NEVER do without CDSCO review:**
- Auto-apply any drug to a prescription
- Suggest a diagnosis
- Hard-block a drug interaction (soft informational only)
- Score clinical risk
- Generate differential diagnosis in active patient record

**V2 implication:** Intelligence VPS sandbox tab operates completely disconnected
from active patient record. No write path from VPS to patient record — architecturally impossible.

---

## Decision Impact on Schema

| Decision | Tables Affected | Schema Element |
|---|---|---|
| 1 — Multi-tenancy | All | clinic_id + WITH CHECK on every RLS |
| 2 — OCC | queue_entries | version INTEGER |
| 3 — Soft delete | patients | is_anonymized, anonymized_at |
| 4 — Consent transaction | patients, patient_consents | Atomic RPC |
| 5 — Supabase Managed | Infrastructure | No schema impact |
| 6 — Clinic mode | clinics | clinic_mode ENUM |
| 7 — Drug tiers | master_drugs, doctor_drug_prefs, custom_clinic_drugs | is_banned on master |
| 8 — Read-only AI | None in V1 | analytics_events table (V2 hook only) |
