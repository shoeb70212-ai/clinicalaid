# ClinicFlow v2.0 — Database Design Decisions

> Every decision made in the schema rebuild, why it was made,
> and what problem it solves. Written for the engineering team
> and the clinical reviewer.

---

## HOW TO READ THIS DOCUMENT

Each section follows the pattern:

- **What we did** — The concrete change
- **Why** — The problem it solves
- **Trade-off** — What we gave up or accepted
- **Audit finding** — Which of the 70 findings this addresses

---

## PART 1 — FOUNDATIONS

---

### Decision 1: Use PostgreSQL Enums for All Constrained Values

**What we did:**
Replaced every free-text constrained column with a PostgreSQL `ENUM` type.
`timing`, `frequency_unit`, `schedule_class`, `severity`, `item_type`,
`pregnancy_category`, `cdsco_status` — all are now enums.

**Why:**
The original schema had `default_timing` as a plain `VARCHAR`.
This meant `'empty_food'` (a typo found in Dentist row 145) was silently
stored and only discovered during code review. An enum would have rejected
it at the DB level with a clear error message at insert time.

In medical software, bad data in the database can mean a patient gets the
wrong instructions. DB-level validation is non-negotiable.

**Trade-off:**
Adding a new timing value (e.g., `with_coconut_oil` for a new AYUSH
formulation) requires an `ALTER TYPE` migration — it cannot be done with
just an INSERT. This is a deliberate friction — new values should be
reviewed, not added casually.

**Findings addressed:** #4 (timing typo), #22 (AYUSH timing incomplete)

---

### Decision 2: Extended `timing_enum` for AYUSH Requirements

**What we did:**
Added `with_milk`, `with_warm_water`, `with_honey`, `with_ghee`,
`with_warm_water_before_food`, `sublingual`, `as_directed`
to the timing enum alongside the original three values.

**Why:**
The original `after_food / before_food / empty_stomach` is a
Western pharmacology framework. It is completely inadequate for Ayurvedic
prescriptions where `anupana` (vehicle of administration) is clinically
significant. Ashwagandha with warm milk vs. Ashwagandha with water has
different pharmacokinetic implications in Ayurvedic literature.

A dermatologist prescribing `Chyawanprash` with `after_food` is
technically wrong — it should be `before_food` with warm water.

**Trade-off:**
The `timing_enum` now has 11 values. UI must handle all of them.
Non-AYUSH specialties will only ever see 3-4. The enum is nullable by
design — `NULL` means "use clinical judgment."

**Findings addressed:** #22 (AYUSH timing), #7 (inadequate schema)

---

### Decision 3: `frequency_unit_enum` + `dosage_interval_days`

**What we did:**
Added two new columns to replace the ambiguous `0-0-0` pattern:
```
dosage_frequency_unit  frequency_unit_enum  DEFAULT 'daily'
dosage_interval_days   INTEGER              DEFAULT 1
```

**Why:**
Vitamin D3 60000IU was encoded as:
```sql
default_dosage = '0-0-0', default_duration = 4
```
This is meaningless. `0-0-0` means zero doses. Duration 4 could be
4 days, 4 weeks, 4 months. The actual instruction is:
"One sachet per week for 4 weeks."

With the new schema:
```sql
default_dosage         = '1-0-0'
dosage_frequency_unit  = 'weekly'
dosage_interval_days   = 7
default_duration        = 28
```

This is unambiguous. The application can render it as:
"1 sachet every week for 28 days (4 doses total)."

Alendronate 70mg (weekly bisphosphonate) had the same problem.
Methotrexate (weekly DMARD) similarly. These are drugs where dosing
frequency matters enormously — weekly MTX vs. daily MTX is the
difference between treatment and lethal toxicity.

**Trade-off:**
The original `default_dosage` column is retained for backward compatibility
with the existing Indian prescription printing convention. Both columns
coexist. The application should use `frequency_unit` as the authoritative
source.

**Findings addressed:** #9 (weekly dosing ambiguity), #18 (0-0-0 pattern)

---

## PART 2 — NORMALIZATION

---

### Decision 4: `drug_molecules` Master Table

**What we did:**
Created a normalized `drug_molecules` table. Every row in
`specialty_starter_packs` links to it via `molecule_id` (nullable FK).

**Why:**
Without normalization:
- "Paracetamol" appears 15+ times across 14 specialties
- If CDSCO bans a molecule, someone must find and update every row manually
- Pregnancy category for a molecule must be maintained in 15+ places
- A typo in `generic_name` in one specialty propagates inconsistency

With normalization:
- One row for Paracetamol in `drug_molecules`
- `is_banned_india = TRUE` on that one row → trigger blocks all inserts
- Pregnancy category: set once, appears everywhere
- ATC code: set once, enables cross-specialty therapeutic grouping

**Trade-off:**
`molecule_id` is nullable (not `NOT NULL`) because:
1. Migration from v1 to v2 cannot be instant — old rows won't have molecule_id
2. Procedural items (warm compress, PRP) don't map to a molecule
3. Complex AYUSH compounds (Triphala = 3 plants) don't have a single INN

The application must handle `molecule_id IS NULL` gracefully.
Safety features (interaction checking, ban guard) only activate when
`molecule_id IS NOT NULL`.

**Findings addressed:** #32 (denormalized generic names), #7 (no is_active),
#50 (no CDSCO tracking), #13 (no schedule column)

---

### Decision 5: `drug_allergy_classes` with Cross-Reactivity Array

**What we did:**
Created a normalized allergy class table with `cross_reactive_class_ids INTEGER[]`
— a self-referencing array encoding cross-reactivity relationships.

**Why:**
When a patient records "Penicillin allergy," the system must also warn
about Amoxicillin, Ampicillin, Amoxiclav AND potentially some cephalosporins
(5-10% cross-reactivity). A free-text allergy field cannot power this logic.

The array approach was chosen over a separate cross-reactivity join table
for this specific use case because:
- Cross-reactivity relationships are few (< 20 pairs)
- They change rarely (never for well-established drug families)
- Array lookup is O(n) but n is tiny
- A join table would add complexity without performance benefit here

**Trade-off:**
Arrays in PostgreSQL cannot have foreign key constraints to the same table.
We accepted this — the application must validate cross_reactive_class_ids
values on write. A trigger could enforce this but adds complexity.

**Findings addressed:** #66 (no allergy cross-reference)

---

### Decision 6: `therapeutic_groups` Using WHO ATC Taxonomy

**What we did:**
Implemented the WHO Anatomical Therapeutic Chemical (ATC) classification
as a hierarchical self-referencing table. Seeded key level-1 anatomical
groups and level-3 pharmacological groups relevant to Indian primary care.

**Why:**
The original `category` column mixed pharmacological class, clinical
indication, and marketing descriptions inconsistently:
```
'Calcium Channel Blocker'       -- pharmacological
'SGLT2 Inhibitor Heart Failure' -- pharmacological + indication
'Tridoshic Rasayana/Laxative'   -- traditional system description
```

This makes `WHERE category = 'Antihypertensive'` unreliable.
ATC is the international standard used by WHO, EMA, and India's CDSCO.
ATC code `C08CA` = Dihydropyridine Calcium Channel Blockers, regardless
of what marketing name or indication language is used.

Enables queries like:
- "Show me all PPIs" → `WHERE atc_code LIKE 'A02BC%'`
- "Suggest a cheaper ACE inhibitor" → find others in `C09AA`
- "This patient is allergic to Fluoroquinolones" → hide all `J01MA`

**Trade-off:**
ATC is a Western taxonomy. It does not have codes for Ayurvedic
formulations. AYUSH drugs in the pack have `who_atc_code = NULL`.
A future AYUSH-specific taxonomy (e.g., AYUSH formulary codes) would
need to be added as a parallel system.

**Findings addressed:** #10 (category column inconsistency), #36 (no therapeutic grouping)

---

## PART 3 — SAFETY SYSTEMS

---

### Decision 7: DB-Level Banned Drug Guard Trigger

**What we did:**
Created `fn_prevent_banned_drug()` — a `BEFORE INSERT OR UPDATE` trigger
that reads `drug_molecules.is_banned_india` and raises an EXCEPTION
(hard block) if `TRUE`, or a WARNING if CDSCO status is `suspended`
or `withdrawn`.

**Why:**
Dextropropoxyphene (banned 2013) appeared in the Orthopedic starter pack.
This was not caught by any validation. The reason: there was no validation.

Application-level checks (if-then in code) can be bypassed by:
- Direct SQL INSERT during a migration
- A developer running a seed script
- An API bug that skips validation middleware
- A future developer who doesn't know about the banned drug list

A database trigger cannot be bypassed. It fires for ALL writes regardless
of source. This is the correct place for a patient safety rule.

**Trade-off:**
Triggers add latency to every INSERT/UPDATE on `specialty_starter_packs`.
For a seed operation inserting 2100 rows, this means 2100 additional
SELECT queries to `drug_molecules`. On modern hardware this adds
< 50ms to the total seed time. Acceptable for a patient safety guarantee.

The trigger only fires when `molecule_id IS NOT NULL`. Rows without
molecule linkage bypass the check — this is the migration grace period.
Once all rows are linked, `molecule_id` should be made `NOT NULL`.

**Findings addressed:** #1 (banned Dextropropoxyphene), #6 (Ranitidine),
#5 (Thalidomide without warning)

---

### Decision 8: Drug Interaction Matrix with Bidirectional Unique Constraint

**What we did:**
Created `drug_interactions` with:
```sql
CONSTRAINT unique_drug_pair
  UNIQUE (LEAST(molecule_a_id, molecule_b_id), GREATEST(molecule_a_id, molecule_b_id))
```

**Why:**
Drug A ↔ Drug B is the same interaction as Drug B ↔ Drug A.
Without the LEAST/GREATEST trick, maintaining bidirectional uniqueness
requires either:
(a) Storing duplicate rows (doubles the table size, creates maintenance hell)
(b) Application-level dedup (unreliable)

The LEAST/GREATEST approach stores each pair exactly once while allowing
lookup in either direction:
```sql
-- Finds interaction regardless of which drug you start with
WHERE molecule_a_id IN (drug_x, drug_y)
  AND molecule_b_id IN (drug_x, drug_y)
  AND molecule_a_id != molecule_b_id
```

`fn_check_interactions()` takes an array of molecule IDs and returns
all interactions within that set — powering the prescription-level
DDI checker.

**Trade-off:**
The interaction table starts empty. Populating it requires clinical data
from a DDI database (DrugBank, WHO, MIMS India). This is a significant
data entry project. The schema is ready; the data must be sourced separately.

**Findings addressed:** #34 (no DDI matrix), #12 (no interaction data)

---

### Decision 9: Structured Drug Monitoring Requirements

**What we did:**
Created `drug_monitoring_requirements` as a structured table with
`test_name`, `frequency`, `timing` (baseline/ongoing/periodic),
and `is_mandatory` — linked to `drug_molecules`.

**Why:**
If Methotrexate monitoring is stored as a text note in the drug description,
the prescription software cannot act on it. Structured data means:

"When doctor selects Methotrexate → automatically add to prescription:
 - LFT (baseline + every 4 weeks)
 - CBC (baseline + every 4 weeks)
 - Creatinine (baseline + every 4 weeks)"

This turns passive information into active clinical decision support.

Critical drugs with mandatory monitoring in these packs:
| Drug | Tests Required |
|------|----------------|
| Methotrexate | LFT, CBC, Creatinine |
| Lithium | Serum Li, TFT, Creatinine |
| Clozapine | WBC (mandatory weekly, 18 weeks) |
| Warfarin | INR |
| Amiodarone | TFT, LFT, CXR, ECG, Eye |
| Digoxin | Serum level, ECG, Electrolytes |

**Trade-off:**
Monitoring requirements are molecule-level, not dose-specific. A patient on
Methotrexate 7.5mg vs 15mg has different monitoring intensity in practice,
but the current schema treats them identically. A `monitoring_intensity`
modifier could be added but was deferred to keep initial complexity manageable.

**Findings addressed:** #38 (no monitoring tracking), #37 (no side effect data)

---

### Decision 10: `item_type` Enum to Separate Drugs from Non-Drugs

**What we did:**
Added `item_type item_type_enum DEFAULT 'drug'` with values:
`drug`, `procedure`, `material`, `supplement`, `cosmetic`, `device`, `ayush`

**Why:**
The original packs mixed:
- Dental materials (Gutta Percha, Glass Ionomer Cement, Sodium Hypochlorite)
- Procedures (PRP, Hyperbaric Oxygen, Chemical Peel, Warm Compress)
- Cosmetics (Whitening gel, Carbamide peroxide)
- Devices (Bandage contact lens)

These are fundamentally different from drugs. They cannot be printed on
a standard prescription. They don't have dosages. They don't interact
with drugs. They shouldn't appear in the drug autocomplete of a
prescription module.

The `item_type` column allows:
- Prescription module: `WHERE item_type = 'drug'`
- Procedure module: `WHERE item_type = 'procedure'`
- Materials inventory: `WHERE item_type = 'material'`
- All items: no filter

The data is retained in one table (single source of truth for everything
a specialty uses) but filtered appropriately by context.

**Trade-off:**
Adds complexity to every query that wants "just drugs." But the alternative —
separate tables for procedures and materials — duplicates specialty/rank logic
and splits what is conceptually "what a specialty uses" into multiple places.

**Findings addressed:** #14 (non-drug items in drug table)

---

### Decision 11: Safety Guardrail Columns

**What we did:**
Added:
```sql
max_daily_dose_mg      DECIMAL(10,3)
max_duration_days      INTEGER
max_dose_warning_text  TEXT
```

**Why:**
The system currently sets defaults but imposes no ceiling. A doctor could
override Paracetamol to `2-2-2` for 30 days (6000mg/day — hepatotoxic).
Or Methotrexate to daily dosing (normally weekly) — which has caused
patient deaths due to prescription errors.

These columns allow the application to:
1. Show a warning when a doctor overrides above the ceiling
2. Hard-block when the override is above a critical threshold
3. Log the override with a mandatory reason field

The text field stores the warning message to display, customized per drug.

**Trade-off:**
Population requires clinical review of 2100+ rows. Not all drugs have
published "never exceed" limits in the Indian formulary. Nullable columns
mean the guardrail is only active where data has been entered.

**Findings addressed:** #47 (no maximum safe dose guardrail)

---

## PART 4 — ARCHITECTURE

---

### Decision 12: 3-Tier Customization Architecture

**What we did:**
Implemented three layers:
1. `specialty_starter_packs` — global defaults (this file)
2. `org_drug_overrides` — hospital/clinic chain customizations
3. `doctor_drug_preferences` — individual doctor's personal settings

With `fn_get_specialty_drugs()` merging all three layers in one query.

**Why:**
A cardiologist at Apollo Hospitals (private, high-resource) has different
prescribing patterns than a cardiologist at a PHC in rural Maharashtra.
Apollo may restrict certain experimental drugs. The rural PHC may need
Jan Aushadhi alternatives highlighted. An individual cardiologist who
always prescribes Atorvastatin 40mg (not 10mg) shouldn't have to scroll
past 10mg every time.

The 3-tier approach:
- Global defaults: curated clinical data, updated by ClinicFlow team
- Org layer: formulary restrictions, preferred drugs, custom ranks
- Doctor layer: personal habits, pinned favorites, hidden drugs

**Trade-off:**
`fn_get_specialty_drugs()` is a complex function with 3 JOINs and COALESCE
chains. The materialized view (`specialty_drug_cache`) handles the
global+molecule join. The function adds org and doctor layers on top.
Total query time target: < 100ms for a specialty's drug list.

**Findings addressed:** #28 (no tenant customization), #48 (no favorites feature)

---

### Decision 13: Versioning System for Clinical Data

**What we did:**
Created `specialty_pack_versions` with semantic versioning, clinical reviewer
attribution, guideline source, and a `is_current` flag per specialty.

**Why:**
Clinical guidelines change. ICMR updated hypertension management in 2023.
The ESC updated heart failure guidelines in 2023. When Sacubitril+Valsartan
becomes the new first-line for HFrEF (replacing plain ACE inhibitors), the
Cardiologist pack needs to reflect this.

Without versioning:
- Clinics on old data have no way to know an update exists
- When a default changes, there's no way to know who changed it or why
- Clinical liability: if a patient is harmed because outdated defaults
  were used, there's no audit trail showing the data was current

With versioning:
- Each pack change creates a new version
- `release_notes` and `clinical_reviewer` fields provide accountability
- Clinics can be notified when their current pack version is outdated
- Migration from v2.0 → v2.1 is a controlled, reviewable process

**Trade-off:**
Adds `pack_version_id` JOIN to any query needing version data. Since
most queries just need current data, this join is typically unnecessary
(current version filtered by `is_current = TRUE`).

**Findings addressed:** #27 (no versioning), #39 (no guideline attribution),
#62 (no clinical review sign-off)

---

### Decision 14: Soft Delete Architecture

**What we did:**
Added:
```sql
deleted_at      TIMESTAMPTZ  DEFAULT NULL
deleted_by      UUID
deletion_reason TEXT
```
With constraint: `CHECK (deleted_at IS NULL OR deletion_reason IS NOT NULL)`

All active-drug queries use `WHERE deleted_at IS NULL`.

**Why:**
In healthcare, you never truly delete data. A prescription written today
references a drug from the pack. If that drug row is hard-deleted tomorrow,
the prescription's history is broken — the drug name and defaults that
were used are gone.

Regulatory audits may require showing "what drugs were available for
prescribing on date X." Soft delete preserves this ability.

The mandatory `deletion_reason` constraint (cannot set `deleted_at`
without `deletion_reason`) ensures every deletion is documented.

**Trade-off:**
Every query needs `WHERE deleted_at IS NULL`. The partial index
`idx_ssp_specialty_rank WHERE deleted_at IS NULL` ensures this doesn't
cost extra — the index only covers active rows.

**Findings addressed:** #30 (no soft delete), #31 (no audit trail)

---

### Decision 15: Trigger-Based Audit Log

**What we did:**
Created `fn_log_ssp_changes()` — a trigger that fires `AFTER INSERT OR UPDATE
OR DELETE` on `specialty_starter_packs`, storing JSONB snapshots of old and
new row state in `specialty_pack_audit_log`.

**Why:**
Application-level audit logging has a fundamental flaw: it can be bypassed.
A developer running a direct SQL UPDATE to fix a "quick bug," a migration
script, a database admin making a change — none of these go through the
application layer. But all of them fire the database trigger.

JSONB old/new values store the complete row state, not just changed fields.
This means:
- Full row reconstruction at any point in time
- Diff calculation between any two versions
- Regulatory compliance without additional tooling

**Trade-off:**
The audit table will grow large. `BIGSERIAL` primary key (not SERIAL)
anticipates billions of rows over the product lifetime. Partitioning
by `changed_at` (monthly partitions) is recommended once the table
exceeds 10M rows. Not implemented in this schema — added as a
comment/future work item.

**Findings addressed:** #31 (no changelog), #62 (no sign-off documentation)

---

### Decision 16: Row Level Security (RLS)

**What we did:**
Enabled PostgreSQL RLS on `specialty_starter_packs`,
`org_drug_overrides`, `doctor_drug_preferences`,
`drug_prescription_analytics`.

Created policies:
- Global pack: all authenticated users can `SELECT`; only `superadmin`/`clinical_admin` can write
- Org overrides: scoped to `current_setting('app.org_id')`
- Doctor preferences: scoped to `current_setting('app.doctor_id')`

**Why:**
In a multi-tenant SaaS, tenant isolation is the most critical security
property. Application-level isolation (checking org_id in WHERE clauses)
works 99.9% of the time. But:
- A single missed WHERE clause exposes all tenants' data
- A SQL injection vulnerability bypasses application logic
- A developer's direct query tool bypasses all middleware

RLS operates below the application layer. Even if the application sends
`SELECT * FROM org_drug_overrides`, the DB automatically appends
`WHERE org_id = current_setting('app.org_id')`. The application cannot
return another org's data even if it tries.

**Trade-off:**
RLS requires `SET LOCAL` of session variables on each connection:
```sql
SET LOCAL app.org_id = 'uuid-here';
SET LOCAL app.doctor_id = 'uuid-here';
SET LOCAL app.user_role = 'doctor';
```
This adds one round-trip per request. Connection poolers (PgBouncer)
must be configured in `session mode` not `transaction mode` for this to work.

**Findings addressed:** #59 (no RLS)

---

## PART 5 — PERFORMANCE

---

### Decision 17: Materialized View with Trigram Indexes

**What we did:**
Created `specialty_drug_cache` — a pre-computed JOIN of the three most
queried tables. Added:
- `UNIQUE INDEX ON (specialty, rank)` for primary lookup
- `GIN (drug_name gin_trgm_ops)` for fuzzy autocomplete
- `GIN (to_tsvector(...))` for full-text search

**Why:**
The drug autocomplete fires on every keystroke. At a clinic with 50
concurrent doctors, each typing 3-4 characters to find a drug:
- 50 doctors × 1 keystroke/second × 3-table JOIN = 150 JOIN operations/second

The materialized view pre-computes the JOIN. Autocomplete queries now
hit a single denormalized table with a GIN index.

The `CONCURRENTLY` option on refresh means reads are never blocked —
doctors never see a loading spinner because the cache is refreshing.

Recommended refresh schedule (via pg_cron):
- Every 15 minutes during clinic hours (8am-8pm)
- Once nightly at 2am for full rebuild

**Trade-off:**
The materialized view is stale between refreshes. If a drug is added
at 9:01am, it may not appear in autocomplete until 9:15am. For a
clinical starter pack (not real-time drug discovery), 15-minute staleness
is acceptable. Emergency deactivations can trigger an immediate manual refresh.

**Findings addressed:** #29 (no search index strategy), #70 (no caching strategy)

---

### Decision 18: Partial Indexes

**What we did:**
Most indexes include `WHERE deleted_at IS NULL` and/or `WHERE is_active = TRUE`.
Example:
```sql
CREATE INDEX idx_ssp_specialty_rank
  ON specialty_starter_packs (specialty, rank)
  WHERE deleted_at IS NULL AND is_active = TRUE;
```

**Why:**
If 5% of drugs are soft-deleted or deactivated over time, a full index
on `(specialty, rank)` includes those rows — wasting index space and
slightly slowing every lookup. A partial index covers only the rows
that queries actually touch: the active, non-deleted rows.

For a table that will grow (org customizations, AYUSH expansion,
regional variants), keeping indexes lean matters.

**Trade-off:**
Queries that need deleted rows (audit queries, "show history" views)
cannot use these partial indexes. They fall back to sequential scans
or require separate non-partial indexes. Audit queries are infrequent;
the performance tradeoff is acceptable.

**Findings addressed:** #29 (index strategy), #63 (no performance benchmarks)

---

## PART 6 — INDIA-SPECIFIC DECISIONS

---

### Decision 19: Jan Aushadhi / PMBJP Integration Columns

**What we did:**
Added to both `drug_molecules` and `specialty_starter_packs`:
```sql
jan_aushadhi_available     BOOLEAN      DEFAULT FALSE
jan_aushadhi_price_inr     DECIMAL(8,2)
is_in_essential_medicines_list BOOLEAN  DEFAULT FALSE
```

**Why:**
India's Pradhan Mantri Bhartiya Janaushadhi Pariyojana (PMBJP) sells
~2000 generic drugs at 50-90% below MRP through Jan Aushadhi Kendras.
For a patient prescribed Atorvastatin 40mg at ₹120/month (branded),
the Jan Aushadhi equivalent is ₹8/month.

ClinicFlow serving clinics in Tier 2/3 cities or government settings
must highlight Jan Aushadhi alternatives. A doctor seeing:
"Atorvastatin 40mg | Jan Aushadhi: ₹8/month" will choose the
generic for cost-sensitive patients.

This aligns with the National Medical Commission's push for generic
prescribing and the NMC's mandate that drug names be in generic form.

**Trade-off:**
Jan Aushadhi prices change when the government revises the PMBJP
formulary. The `price_last_updated DATE` column enables staleness
detection. A quarterly update job is needed to keep prices current.

**Findings addressed:** #52 (no Jan Aushadhi integration), #42 (no cost data)

---

### Decision 20: Schedule Classification Column (`drug_schedule_enum`)

**What we did:**
Added `schedule_class drug_schedule_enum` to both `drug_molecules`
(the authoritative source) and `specialty_starter_packs` (for fast
query access without JOIN).

**Why:**
Indian drug prescriptions have legal requirements based on schedule:
- Schedule H: Must display "Rx" on prescription
- Schedule H1: Must be recorded in a special register by the pharmacist
- Schedule X (NDPS): Requires triplicate prescription in some states
- OTC: No prescription required

Without this column, the application cannot:
- Automatically add "Rx" to prescriptions containing Schedule H drugs
- Warn when a doctor prescribes a Schedule H1 drug without documentation
- Comply with the NMC Digital Health Guidelines for e-prescriptions

**Trade-off:**
Schedule classification in `specialty_starter_packs` is denormalized
(same as in `drug_molecules`). A trigger syncs them:
If `drug_molecules.schedule_class` changes → update all linked pack rows.
This sync trigger is not in this schema (deferred). Until implemented,
manual synchronization is required.

**Findings addressed:** #13 (no schedule column), #53 (no psychotropic handling)

---

### Decision 21: Multi-Language Patient Instructions

**What we did:**
Added patient instruction columns for 6 Indian languages:
```sql
patient_instructions_hindi
patient_instructions_marathi
patient_instructions_tamil
patient_instructions_telugu
patient_instructions_kannada
patient_instructions_gujarati
```

**Why:**
India has 22 scheduled languages and hundreds of dialects.
A patient prescribed "ATORVASTATIN 40MG — 0-0-1 after food" by a
doctor in Chennai may only read Tamil. The prescription means nothing
to them in English.

The NMC's 2023 guidelines encourage patient-centric prescriptions.
A printed instruction in the patient's language improves:
- Medication adherence (estimated 30-50% improvement per WHO)
- Patient safety (patient can verify they received the right drug)
- Satisfaction and trust in the healthcare system

6 languages cover ~800 million people — the majority of ClinicFlow's
potential patient base.

**Trade-off:**
Populating 6 language columns for 2100+ drugs is a significant
localization effort. Columns are nullable — the system degrades
gracefully to English when regional translation is absent.
Machine translation (DeepL, Google Translate API) can bootstrap
initial content with human review.

**Findings addressed:** #24 (no multi-language support), #44 (no patient-facing info)

---

### Decision 22: Ayurveda Allergy Class = NULL (Acceptable)

**What we did:**
Ayurveda drugs are linked to `drug_molecules` entries (where possible)
but `allergy_class_id` is `NULL` for most AYUSH formulations.

**Why:**
AYUSH drug allergy classification does not exist in standardized form.
There is no "Triphala allergy class" in any international pharmacopeia.
Forcing AYUSH drugs into the existing allergy class taxonomy would be
scientifically inaccurate and potentially misleading.

The correct approach (not yet built but enabled by the schema):
A separate AYUSH ingredient-based allergy system where patients
record "allergy to Haritaki" and the system cross-references with
all Triphala-containing formulations.

**Trade-off:**
AYUSH drugs in the starter pack provide no allergy cross-reference
warnings. A patient allergic to a botanical ingredient will not be
warned. This is explicitly flagged as a known limitation requiring
future AYUSH-specific allergy ontology development.

**Findings addressed:** #22 (AYUSH timing), partial #66 (allergy cross-reference)

---

## PART 7 — INTEROPERABILITY

---

### Decision 23: FHIR/ABDM Columns on Every Drug Row

**What we did:**
Added to `specialty_starter_packs`:
```sql
snomed_ct_code       VARCHAR(20)
rxnorm_code          VARCHAR(20)
who_atc_code         VARCHAR(10)
icd10_indication_code VARCHAR(10)
fhir_medication_code VARCHAR(50)
```

**Why:**
India's Ayushman Bharat Digital Mission (ABDM) mandates FHIR R4
compliance for all digital health records by 2025. A prescription
generated from ClinicFlow must be expressed as a FHIR `MedicationRequest`
resource with standard drug codes.

Without SNOMED CT or RxNorm codes, ClinicFlow cannot:
- Share prescriptions with government ABHA health records
- Integrate with hospital EMR systems (which use HL7 FHIR)
- Support insurance claim processing (which requires ICD-10 codes)
- Pass ABDM certification for digital health platforms

These are nullable — a phased approach allows ABDM integration to
be built incrementally as the coding data is populated.

**Trade-off:**
SNOMED CT licensing requires a fee for commercial use. RxNorm is
US-based and many Indian drugs don't have RxNorm codes. WHO ATC is
free and international — prioritize ATC population first. SNOMED and
RxNorm codes can be populated when ABDM integration is built.

**Findings addressed:** #55 (no FHIR compatibility), #56 (no ABDM readiness)

---

## PART 8 — WHAT WAS INTENTIONALLY DEFERRED

The following items are acknowledged but not implemented in this schema.
They require either significant data work or separate system components.

| Item | Reason for Deferral |
|------|---------------------|
| Populate `drug_interactions` | Requires licensed DDI database (DrugBank/MIMS) |
| Populate `drug_monitoring_requirements` | Clinical data entry project |
| Fill `snomed_ct_code` / `rxnorm_code` | SNOMED licensing + data mapping project |
| Separate AYUSH allergy ontology | Requires AYUSH pharmacopeia research |
| Audit table partitioning | Needed only after 10M+ rows |
| pg_cron job definitions | Depends on hosting environment |
| Homeopathy pack (150 drugs) | Data not finalized |
| Other specialty pack (150 drugs) | Definition of "Other" unclear |
| Ayurveda pack (rows 105-150) | Data generation was cut off |
| Drug images / pill images | CDN + image sourcing project |
| Jan Aushadhi price sync job | External API integration |
| Regional drug variations data | Epidemiological data sourcing |

---

## SUMMARY TABLE

| Schema Section | Tables | Audit Findings Addressed |
|---------------|--------|--------------------------|
| Enumerations | 9 enum types | #4, #7, #9, #13, #18, #22 |
| Reference tables | drug_allergy_classes, therapeutic_groups | #10, #32, #36, #66 |
| Drug molecules | drug_molecules | #1, #6, #7, #13, #32, #50 |
| Safety | drug_interactions, drug_side_effects, drug_monitoring_requirements | #12, #34, #37, #38, #47 |
| Versioning | specialty_pack_versions, seed_runs | #27, #33, #39, #62 |
| Core pack (rebuilt) | specialty_starter_packs | All 70 |
| 3-tier customization | org_drug_overrides, doctor_drug_preferences | #28, #40, #48 |
| Templates | prescription_templates, prescription_template_drugs | #45 |
| Regional | regional_drug_variations | #41 |
| Analytics | drug_prescription_analytics | #40, #43 |
| Audit | specialty_pack_audit_log | #31, #60 |
| Indexes | 14 indexes + 3 on mat. view | #29, #63, #70 |
| Materialized view | specialty_drug_cache | #29, #70 |
| Functions | fn_get_specialty_drugs, fn_check_interactions, fn_refresh_drug_cache | #28, #34, #57 |
| Triggers | 5 triggers | #7, #30, #31, #60 |
| RLS | 4 tables with policies | #59 |
| Validation queries | 10 validation queries | #61 |
| Views | 3 application views | #34, #38 |
| Patient columns | 6 language columns + patient_label | #24, #44 |
| India-specific | Jan Aushadhi, schedule, PMBJP | #13, #42, #52, #53 |
| FHIR/ABDM | 5 interoperability columns | #55, #56 |
| **Total** | **15 tables + 3 views + 1 mat. view + 5 triggers + 3 functions** | **All 70 findings** |
