# Drug Database — 3-Tier Architecture

---

## Overview

```
Tier 1: master_drugs          Cloud only. Read-only for clinics. ClinicFlow team maintains.
Tier 2: doctor_drug_prefs     Per-doctor batch. Cloud + local sync. Fast offline search.
Tier 3: custom_clinic_drugs   Per-clinic sandbox. Never pollutes master.
```

300,000+ Indian drug SKUs exist. A doctor's actual working universe = 100–200 drugs.
Local device cannot download the full master. Local batch is fast. Master is the fallback.

---

## Tier 1: master_drugs (cloud only, read-only)

**Maintained by:** ClinicFlow team via admin dashboard
**Source:** Indian drug databases (1mg API, CIMS, CDSCO registry)
**Size:** 300,000+ rows
**Access:** All clinics can search. No clinic can write.

**Key columns:**
```
name          TEXT      -- PARACETAMOL 650mg
generic_name  TEXT      -- Paracetamol
category      TEXT      -- Analgesic / Antipyretic
schedule      TEXT      -- H, H1, X, OTC
is_banned     BOOLEAN   -- CDSCO banned flag
ban_date      DATE
ban_reason    TEXT
```

**Search:** pg_trgm fuzzy index on `name`. Enable extension:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_drugs_trgm ON master_drugs USING gin(name gin_trgm_ops);
```

**Banned drug query:**
```sql
SELECT is_banned, ban_date, ban_reason
FROM master_drugs
WHERE name ILIKE $searchTerm
  AND is_banned = TRUE;
-- If result returned: hard block in UI. Prescription cannot be finalised.
```

---

## Tier 2: doctor_drug_preferences (doctor batch — cloud + local)

**Maintained by:** System (automated)
**Size:** 100–500 rows per doctor
**Source:** Specialty starter pack on onboarding + selections from master + custom drugs

### Specialty Starter Pack (onboarding injection)

When doctor selects specialty during onboarding, system seeds their batch immediately.

```sql
-- Seed from aggregate anonymous data of same-specialty doctors
-- (pre-curated data initially, AI-improved in V2)
INSERT INTO doctor_drug_preferences(
  clinic_id, doctor_id, drug_name, generic_name, category,
  usage_count, default_dosage, default_duration, default_timing, is_from_master
)
SELECT
  $clinicId, $doctorId,
  drug_name, generic_name, category,
  1, default_dosage, default_duration, default_timing, TRUE
FROM specialty_starter_packs
WHERE specialty = $specialty
ORDER BY rank ASC
LIMIT 150;
```

> `specialty_starter_packs` is a separate seed table curated by ClinicFlow team.
> Pre-populated with top 150 drugs per specialty.
> Doctors start with a full, relevant batch from day one.

### Usage Count Update (learning engine)

Every time doctor adds a drug to a prescription, increment usage_count:

```sql
INSERT INTO doctor_drug_preferences(
  clinic_id, doctor_id, drug_name, usage_count,
  default_dosage, default_duration, default_timing
)
VALUES ($clinicId, $doctorId, $drugName, 1, $dosage, $duration, $timing)
ON CONFLICT (doctor_id, drug_name)
DO UPDATE SET
  usage_count      = doctor_drug_preferences.usage_count + 1,
  default_dosage   = EXCLUDED.default_dosage,
  default_duration = EXCLUDED.default_duration,
  default_timing   = EXCLUDED.default_timing,
  updated_at       = NOW();
```

### Smart Dosage Pre-fill (from usage_count mode)

When doctor selects a drug, pre-fill dosage/duration/timing from their most common pattern:

```typescript
// The default_dosage, default_duration, default_timing columns hold this
// Rendered with soft blue highlight: bg-blue-50 border-blue-200
// Doctor must click [+ Add to Rx] to confirm — never auto-adds
```

---

## Tier 3: custom_clinic_drugs (sandbox)

When doctor is offline or drug not found in master:
- UI shows "Add as Custom Drug" button at bottom of search results
- Doctor types name manually → saved to `custom_clinic_drugs` only
- Never writes to `master_drugs`
- Becomes part of doctor's local batch automatically

### Cross-Clinic Aggregation (weekly admin job)

```sql
-- Find custom drugs added by 50+ different clinics this week
SELECT drug_name, COUNT(DISTINCT clinic_id) as clinic_count
FROM custom_clinic_drugs
WHERE created_at > NOW() - INTERVAL '7 days'
  AND flagged_for_review = FALSE
GROUP BY drug_name
HAVING COUNT(DISTINCT clinic_id) >= 50
ORDER BY clinic_count DESC;
```

Result appears in ClinicFlow admin dashboard for manual review.
If legitimate new drug: admin adds to master_drugs and marks as reviewed.
If typo/variant: admin ignores. Custom drug remains in clinic sandboxes only.

---

## Search Flow

```typescript
// src/lib/drugSearch.ts

export async function searchDrugs(
  query: string,
  doctorId: string,
  clinicId: string,
  isOnline: boolean
): Promise<DrugResult[]> {

  // Step 1: Always search doctor's local batch first (fast, offline-capable)
  const { data: batchResults } = await supabase
    .from('doctor_drug_preferences')
    .select('*')
    .eq('doctor_id', doctorId)
    .eq('clinic_id', clinicId)
    .ilike('drug_name', `%${query}%`)
    .order('usage_count', { ascending: false })
    .limit(10);

  if (batchResults && batchResults.length > 0) {
    return batchResults.map(r => ({ ...r, source: 'batch' }));
  }

  // Step 2: If online, fall back to master (fuzzy trgm search)
  if (isOnline) {
    const { data: masterResults } = await supabase
      .from('master_drugs')
      .select('*')
      .textSearch('name', query, { type: 'websearch' })
      .limit(10);

    // Also check custom sandbox
    const { data: customResults } = await supabase
      .from('custom_clinic_drugs')
      .select('*')
      .eq('clinic_id', clinicId)
      .ilike('drug_name', `%${query}%`)
      .limit(5);

    return [
      ...(masterResults || []).map(r => ({ ...r, source: 'master' })),
      ...(customResults  || []).map(r => ({ ...r, source: 'custom' })),
    ];
  }

  // Offline + not in batch: show "Add as Custom Drug" option only
  return [];
}
```

---

## Banned Drug Enforcement

```typescript
// Called when doctor selects any drug from any tier
export async function checkBannedDrug(drugName: string): Promise<BannedCheck> {
  const { data } = await supabase
    .from('master_drugs')
    .select('is_banned, ban_date, ban_reason')
    .ilike('name', drugName)
    .single();

  if (data?.is_banned) {
    return {
      banned: true,
      date: data.ban_date,
      reason: data.ban_reason,
    };
  }
  return { banned: false };
}

// UI response to banned = true:
// Hard red block overlay on prescription
// Text: "⚠️ ALERT: This drug was banned by CDSCO on [date]. Reason: [reason]"
// Prescription cannot be finalised until drug is removed
// Cannot be bypassed. Log to audit_logs.
```

---

## Suggestion Engine (Market Basket — Apriori)

Pre-calculated associations between drugs for each doctor.
Run as a background DB job (can use pg_cron extension, or external cron).

```sql
-- Weekly: calculate drug co-occurrence for each doctor
-- This is a simplified version — production uses proper Apriori or FP-Growth
SELECT
  a.drug_name AS drug_a,
  b.drug_name AS drug_b,
  COUNT(*) AS co_occurrence
FROM doctor_drug_preferences a
JOIN doctor_drug_preferences b
  ON a.doctor_id = b.doctor_id
  AND a.drug_name < b.drug_name
WHERE a.usage_count > 3 AND b.usage_count > 3
GROUP BY a.drug_name, b.drug_name
HAVING COUNT(*) > 5
ORDER BY co_occurrence DESC;
```

Results stored in `drug_associations` table (per doctor).
Synced to doctor's local batch.
When doctor adds Drug A → show chips for associated drugs.
Doctor taps chip to add. Nothing auto-added. Ever.

---

## Drug Reconciliation Notification (weekly)

```
Monday morning notification in doctor's app:

"You prescribed a custom drug 'Dolo 650' 14 times last week.
 Did you mean PARACETAMOL 650mg from the master catalog?"

[Yes, link to master]   [No, keep my custom entry]
```

- [Yes]: `doctor_drug_preferences.is_from_master = TRUE`, `master_drug_id` linked
- [No]: `custom_clinic_drugs` entry marked `flagged_for_review = FALSE` for this doctor permanently

---

## i18n for Drug Instructions

Drug names: ALWAYS English. Non-negotiable. NMC mandate.
Patient instructions: local language from `drug_instructions_i18n` table.

```sql
SELECT instruction FROM drug_instructions_i18n
WHERE dosage_code = '1-0-1'
  AND timing_code = 'after_food'
  AND language    = $patientPreferredLanguage;
-- Returns: 'सुबह और शाम, खाने के बाद' for language = 'hi'
```

Fallback chain: patient_language → 'hi' → 'en'. Never silent failure.
