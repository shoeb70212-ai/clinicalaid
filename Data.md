-- ============================================================
-- ClinicFlow — Complete Database Schema v2.0
-- Addresses all 70 audit findings from schema review
-- Run FIRST. Seed data is in 002_clinicflow_v2_seed.sql
-- ============================================================

BEGIN;

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- UUID generation for multi-tenant IDs
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- Trigram fuzzy search for autocomplete
CREATE EXTENSION IF NOT EXISTS unaccent;     -- Language-agnostic search (é, ā, ṭ etc.)


-- ── ENUMERATIONS ──────────────────────────────────────────────────────────────
-- All constrained value columns use enums.
-- Reason: DB-level validation catches typos and bad data before it enters.
--         In medical software, 'empty_food' (a real typo found in Dentist pack)
--         stored silently can mean a patient gets wrong instructions.

-- Indian drug schedule per Drugs and Cosmetics Act 1940
CREATE TYPE drug_schedule_enum AS ENUM (
  'H',           -- Prescription only
  'H1',          -- Prescription + special pharmacist record (Tramadol, Clonazepam etc.)
  'G',           -- Pharmacist supervision
  'L',           -- Restricted to hospitals/institutions
  'X',           -- Narcotic/psychotropic — NOT permitted in starter packs
  'OTC',         -- Over the counter
  'AYUSH',       -- Ayurveda/Unani/Siddha/Homeopathy formulations
  'NARCOTIC',    -- NDPs under NDPS Act 1985
  'PSYCHOTROPIC' -- Psychotropic substances under NDPS Act 1985
);

-- Timing of drug administration
-- Extended from original 3-value set to cover AYUSH anupana requirements.
-- 'anupana' = vehicle of administration; clinically significant in Ayurveda.
CREATE TYPE timing_enum AS ENUM (
  'after_food',
  'before_food',
  'empty_stomach',
  'with_milk',                  -- Ashwagandha, Musali Pak, Shatavari
  'with_warm_water',            -- Most Ayurvedic Churnas
  'with_honey',                 -- Many Avalehas
  'with_ghee',                  -- Ghrita formulations
  'with_warm_water_before_food',-- Digestive compounds (Hingwashtak etc.)
  'with_juice',
  'sublingual',                 -- Nitroglycerine, Buprenorphine SL, Lorazepam SL
  'as_directed'                 -- Topicals, injections, drops, complex protocols
);

-- Dosage frequency unit — fixes the 0-0-0 weekly dose ambiguity.
-- Example: Alendronate 70mg weekly was stored as '0-0-0' for 4 weeks (meaningless).
-- Now: dosage='1-0-0', frequency_unit='weekly', interval_days=7, duration=28.
CREATE TYPE frequency_unit_enum AS ENUM (
  'daily',        -- Standard 1-1-1, 1-0-1 etc.
  'weekly',       -- Alendronate, Methotrexate, Vitamin D 60000IU sachet
  'monthly',      -- Depot injections, Ibandronate 150mg, Zoledronic acid
  'sos',          -- As needed / PRN
  'single_dose',  -- One-time (Fluconazole 150mg, Emergency contraceptive)
  'as_directed'   -- Complex titration schedules
);

-- DDI severity levels per standard pharmacovigilance grading
CREATE TYPE severity_enum AS ENUM (
  'minor',
  'moderate',
  'major',
  'contraindicated'
);

-- Evidence grading for clinical guideline attribution
CREATE TYPE evidence_grade_enum AS ENUM (
  'IA',   -- Systematic review/meta-analysis of RCTs
  'IB',   -- At least one RCT
  'IIA',  -- At least one controlled non-randomized study
  'IIB',  -- At least one quasi-experimental study
  'III',  -- Observational studies
  'IV'    -- Expert opinion / consensus
);

-- Item type — separates drugs from procedures and materials
-- Fixes: PRP kit, GIC, Warm Compress, Whitening gel mixed into the drug table
CREATE TYPE item_type_enum AS ENUM (
  'drug',        -- Prescribable pharmaceutical
  'procedure',   -- Clinical procedure (PRP, Botox injection, Chemical peel)
  'material',    -- Dental/surgical consumable (GIC, Gutta Percha, NaOCl)
  'supplement',  -- Nutritional/nutraceutical supplement
  'cosmetic',    -- Cosmetic/aesthetic agent (Carbamide peroxide)
  'device',      -- Medical device (Bandage lens, IUD, Spirometer)
  'ayush'        -- Classical Ayurvedic/Homeopathic/Unani formulation
);

-- CDSCO registration status
CREATE TYPE cdsco_status_enum AS ENUM (
  'approved',
  'suspended',
  'withdrawn',
  'under_review',
  'banned'        -- Explicit ban via gazette notification
);

-- Product tier for feature gating
-- Top 50 drugs per specialty on 'free'; full 150 on 'pro'; custom on 'enterprise'
CREATE TYPE feature_tier_enum AS ENUM (
  'free',
  'pro',
  'enterprise'
);

-- Pregnancy safety classification
-- X = Contraindicated; N = Not classified (common for AYUSH, many OTC supplements)
CREATE TYPE pregnancy_category_enum AS ENUM (
  'A', 'B', 'C', 'D', 'X', 'N'
);

-- Audit log operation types
CREATE TYPE operation_enum AS ENUM (
  'INSERT', 'UPDATE', 'DELETE'
);

-- Drug monitoring timing
CREATE TYPE monitoring_timing_enum AS ENUM (
  'baseline',           -- Before starting drug
  'ongoing',            -- During treatment
  'on_discontinuation', -- When stopping
  'periodic'            -- At defined intervals
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: REFERENCE / LOOKUP TABLES
-- Global, non-tenant-specific, slow-changing data
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 1: DRUG ALLERGY CLASSES ─────────────────────────────────────────────
-- When a patient records "Penicillin allergy", the system must automatically flag
-- ALL drugs in the penicillin class + cross-reactive classes (some cephalosporins).
--
-- NOTE: cross_reactive_class_ids is an INTEGER[]. PostgreSQL arrays cannot carry
-- foreign key constraints. Application layer must validate array values on write.
-- A separate join table (drug_allergy_cross_reactivity) is recommended for future
-- iteration if cross-reactivity relationships become complex or numerous.

CREATE TABLE drug_allergy_classes (
  id                       SERIAL PRIMARY KEY,
  class_name               VARCHAR(100)  NOT NULL UNIQUE,
  description              TEXT,
  cross_reactive_class_ids INTEGER[],    -- IDs of other allergy classes with cross-reactivity
  examples                 TEXT,         -- Example drugs for UI display
  created_at               TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE drug_allergy_classes IS
  'Normalized allergy classification. Enables patient allergy → drug contraindication cross-reference. '
  'NOTE: cross_reactive_class_ids array has no FK constraint — application must validate on write.';

INSERT INTO drug_allergy_classes (class_name, description, examples) VALUES
('Penicillin class',    'All penicillin-based antibiotics',                         'Amoxicillin, Ampicillin, Piperacillin, Amoxiclav'),
('Cephalosporins',      '5-10% cross-reactivity with penicillins',                  'Cefixime, Cefuroxime, Ceftriaxone, Cephalexin'),
('Sulfonamides',        'Sulfa drug allergy',                                       'Cotrimoxazole, Sulfasalazine, Furosemide (partial)'),
('NSAIDs',              'Aspirin/NSAID hypersensitivity',                           'Ibuprofen, Diclofenac, Naproxen, Aspirin, Ketorolac'),
('Fluoroquinolones',    'Quinolone class allergy',                                  'Ciprofloxacin, Levofloxacin, Moxifloxacin, Ofloxacin'),
('Macrolides',          'Macrolide antibiotic allergy',                             'Azithromycin, Erythromycin, Clarithromycin'),
('Tetracyclines',       'Tetracycline class allergy',                               'Doxycycline, Minocycline, Tetracycline'),
('Opioids',             'Opioid/narcotic allergy or intolerance',                   'Tramadol, Codeine, Morphine, Tapentadol'),
('Statins',             'HMG-CoA reductase inhibitor intolerance',                  'Atorvastatin, Rosuvastatin, Simvastatin'),
('Benzodiazepines',     'BZD class allergy',                                        'Alprazolam, Clonazepam, Diazepam, Lorazepam'),
('Contrast dye',        'Iodinated contrast media allergy',                         'Iohexol, Iopromide'),
('Local anaesthetics',  'Amide or ester local anaesthetic allergy',                 'Lidocaine, Articaine, Bupivacaine, Prilocaine'),
('Latex',               'Latex hypersensitivity (cross-reactive with some foods)',  'Surgical gloves, catheters'),
('Bisphosphonates',     'Bisphosphonate class (MRONJ risk with dental procedures)', 'Alendronate, Zoledronic acid, Ibandronate')
ON CONFLICT DO NOTHING;

-- Penicillins ↔ Cephalosporins cross-reactivity
UPDATE drug_allergy_classes
SET cross_reactive_class_ids = ARRAY[
  (SELECT id FROM drug_allergy_classes WHERE class_name = 'Cephalosporins')
] WHERE class_name = 'Penicillin class';

UPDATE drug_allergy_classes
SET cross_reactive_class_ids = ARRAY[
  (SELECT id FROM drug_allergy_classes WHERE class_name = 'Penicillin class')
] WHERE class_name = 'Cephalosporins';


-- ── TABLE 2: THERAPEUTIC GROUPS (WHO ATC) ─────────────────────────────────────
-- WHO ATC classification as a hierarchical self-referencing table.
-- ATC is the international standard used by WHO, EMA, CDSCO.
-- Enables queries like: "Show all PPIs" → WHERE atc_code LIKE 'A02BC%'
--
-- NOTE: This seed intentionally populates ATC levels 1 and 3 only.
-- Level 2 (therapeutic subgroup) and level 4 (chemical subgroup) are omitted
-- as they add limited value for the current use case. The CHECK constraint
-- allows all levels 1-5; only levels 1 and 3 are seeded here.
-- Add level 2/4 rows when building a full ATC browser or drug class hierarchy UI.

CREATE TABLE therapeutic_groups (
  id              SERIAL PRIMARY KEY,
  group_name      VARCHAR(150)  NOT NULL,
  atc_code        VARCHAR(7)    UNIQUE,       -- e.g., A02BC = Proton Pump Inhibitors
  atc_level       INTEGER       CHECK (atc_level BETWEEN 1 AND 5),
  parent_group_id INTEGER       REFERENCES therapeutic_groups(id),
  description     TEXT,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE therapeutic_groups IS
  'WHO ATC classification hierarchy. Enables therapeutic equivalence lookup and drug class filtering. '
  'Seeded with ATC levels 1 and 3 only. Levels 2 and 4 are intentionally omitted from this seed — '
  'add them when a full ATC hierarchy browser is needed.';

INSERT INTO therapeutic_groups (group_name, atc_code, atc_level) VALUES
-- Level 1: Anatomical major groups
('Alimentary tract and metabolism',         'A',       1),
('Blood and blood forming organs',          'B',       1),
('Cardiovascular system',                   'C',       1),
('Dermatologicals',                         'D',       1),
('Genito urinary system and sex hormones',  'G',       1),
('Systemic hormonal preparations',          'H',       1),
('Anti-infectives for systemic use',        'J',       1),
('Antineoplastic and immunomodulating',     'L',       1),
('Musculoskeletal system',                  'M',       1),
('Nervous system',                          'N',       1),
('Respiratory system',                      'R',       1),
('Sensory organs',                          'S',       1),
-- Level 3: Key pharmacological groups for Indian primary care
('Proton Pump Inhibitors',                  'A02BC',   3),
('ACE Inhibitors',                          'C09AA',   3),
('ARB Antihypertensives',                   'C09CA',   3),
('Calcium Channel Blockers',                'C08CA',   3),
('Beta Blockers',                           'C07AB',   3),
('Statins',                                 'C10AA',   3),
('Antiplatelets',                           'B01AC',   3),
('Oral Anticoagulants NOACs',               'B01AF',   3),
('SGLT2 Inhibitors',                        'A10BK',   3),
('DPP4 Inhibitors',                         'A10BH',   3),
('Biguanides',                              'A10BA',   3),
('Sulfonylureas',                           'A10BB',   3),
('SSRIs',                                   'N06AB',   3),
('SNRIs',                                   'N06AX',   3),
('Atypical Antipsychotics',                 'N05AH',   3),
('Benzodiazepines',                         'N05BA',   3),
('NSAIDs',                                  'M01AB',   3),
('COX2 Inhibitors',                         'M01AH',   3),
('Macrolide Antibiotics',                   'J01FA',   3),
('Fluoroquinolones',                        'J01MA',   3),
('Penicillins',                             'J01CA',   3),
('Cephalosporins',                          'J01DA',   3),
('Antihistamines non-sedating',             'R06AX',   3),
('Nasal Corticosteroids',                   'R01AD',   3),
('Topical Antifungals',                     'D01AC',   3),
('Topical Corticosteroids',                 'D07AC',   3),
('Bisphosphonates',                         'M05BA',   3),
('Anticonvulsants',                         'N03AX',   3),
('Triptans',                                'N02CC',   3),
('Anti-Parkinson Agents',                   'N04BA',   3),
('IOP-Lowering Prostaglandins',             'S01EE',   3),
('IOP-Lowering Beta Blockers',              'S01ED',   3),
('Uterotonic Agents',                       'G02AB',   3),
('Oral Contraceptives',                     'G03AA',   3),
('Inhaled Corticosteroids',                 'R03BA',   3),
('Short-Acting Beta Agonists',              'R03AC',   3),
('Long-Acting Beta Agonists',               'R03AK',   3),
('Leukotriene Antagonists',                 'R03DC',   3),
('H2 Receptor Blockers',                    'A02BA',   3),
('Antiemetics',                             'A04AA',   3),
('Dopamine Agonists Parkinson',             'N04BC',   3),
('Cholinesterase Inhibitors Dementia',      'N06DA',   3)
ON CONFLICT DO NOTHING;


-- ── TABLE 3: DRUG MOLECULES ────────────────────────────────────────────────────
-- Master molecule table = single source of truth for molecule-level data.
-- Reason: Without normalization, "Paracetamol" appears 15+ times across specialties
-- with potentially inconsistent safety data. One row here means any CDSCO ban
-- propagates instantly to ALL 2100+ pack rows via the FK relationship.

CREATE TABLE drug_molecules (
  id                              SERIAL PRIMARY KEY,

  -- WHO Identity
  inn_name                        VARCHAR(200)             NOT NULL UNIQUE,
  who_atc_code                    VARCHAR(10),
  snomed_ct_code                  VARCHAR(20),
  rxnorm_code                     VARCHAR(20),             -- US RxNorm (for FHIR MedicationRequest)
  ddc_code                        VARCHAR(20),             -- Indian Drug Code

  -- Classification
  therapeutic_group_id            INTEGER                  REFERENCES therapeutic_groups(id),
  allergy_class_id                INTEGER                  REFERENCES drug_allergy_classes(id),
  drug_class_l1                   VARCHAR(100),            -- e.g., Cardiovascular
  drug_class_l2                   VARCHAR(100),            -- e.g., Antihypertensive
  drug_class_l3                   VARCHAR(100),            -- e.g., ACE Inhibitor

  -- Indian Regulatory
  cdsco_approval_status           cdsco_status_enum        DEFAULT 'approved',
  cdsco_approval_number           VARCHAR(50),
  cdsco_approval_date             DATE,
  cdsco_withdrawal_date           DATE,
  ban_gazette_notification        TEXT,                    -- e.g., 'GSR 185(E) 2013'
  schedule_class                  drug_schedule_enum,
  is_banned_india                 BOOLEAN                  DEFAULT FALSE,
  is_otc                          BOOLEAN                  DEFAULT FALSE,

  -- Safety Profile
  pregnancy_category              pregnancy_category_enum  DEFAULT 'N',
  is_teratogenic                  BOOLEAN                  DEFAULT FALSE,
  is_narrow_therapeutic_index     BOOLEAN                  DEFAULT FALSE,
  requires_special_monitoring     BOOLEAN                  DEFAULT FALSE,
  is_black_box_warning            BOOLEAN                  DEFAULT FALSE,
  black_box_warning_text          TEXT,

  -- Organ Dose Adjustments
  requires_renal_adjustment       BOOLEAN                  DEFAULT FALSE,
  requires_hepatic_adjustment     BOOLEAN                  DEFAULT FALSE,
  use_caution_elderly             BOOLEAN                  DEFAULT FALSE,
  renal_dose_guide                TEXT,
  hepatic_dose_guide              TEXT,
  elderly_dose_guide              TEXT,

  -- Age restrictions
  min_age_years                   INTEGER                  DEFAULT 0,
  max_age_years                   INTEGER                  DEFAULT 120,
  is_pediatric_approved           BOOLEAN                  DEFAULT TRUE,

  -- India-specific availability
  manufactured_in_india           BOOLEAN                  DEFAULT TRUE,
  import_dependent                BOOLEAN                  DEFAULT FALSE,
  availability_risk               VARCHAR(10)              CHECK (availability_risk IN ('low','medium','high')),
  jan_aushadhi_available          BOOLEAN                  DEFAULT FALSE,
  jan_aushadhi_price_inr          DECIMAL(8,2),
  is_in_essential_medicines_list  BOOLEAN                  DEFAULT FALSE,

  -- ABDM/FHIR Interoperability
  icd10_indication_code           VARCHAR(10),
  fhir_medication_code            VARCHAR(50),

  -- Metadata
  created_at                      TIMESTAMPTZ              DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ              DEFAULT NOW()
);

COMMENT ON TABLE drug_molecules IS
  'Master normalized drug molecule table. Single source of truth for molecule-level data. '
  'All specialty_starter_packs rows should link here via molecule_id. '
  'molecule_id is nullable during v1→v2 migration period and for procedural items.';

-- Seed critical banned/withdrawn molecules — the banned drug trigger reads from this table
-- Ranitidine: NOT banned (is_banned_india=FALSE) but is WITHDRAWN (NDMA contamination 2020)
--             → triggers WARNING, not EXCEPTION when linked
INSERT INTO drug_molecules (inn_name, is_banned_india, ban_gazette_notification, cdsco_approval_status) VALUES
('Dextropropoxyphene',      TRUE,  'GSR 185(E) dated 10.03.2013',        'banned'),
('Ranitidine',              FALSE, 'CDSCO advisory 2020 (NDMA contamination)', 'withdrawn'),
('Nimesulide Paediatric',   TRUE,  'G.S.R. 82(E) dated 10.02.2011',      'banned'),
('Sibutramine',             TRUE,  'G.S.R. 739(E) dated 10.10.2010',     'banned'),
('Phenacetin',              TRUE,  'Historical ban pre-2000',             'banned'),
('Methylphenidate',         FALSE, NULL,                                  'approved')  -- Schedule X, NOT banned but excluded from starter packs
ON CONFLICT (inn_name) DO NOTHING;


-- ── TABLE 4: DRUG INTERACTIONS ─────────────────────────────────────────────────
-- Bidirectional unique constraint via LEAST/GREATEST trick.
-- Drug A ↔ Drug B = Drug B ↔ Drug A. This prevents storing duplicate pairs.
--
-- NOTE: This table starts EMPTY in this schema.
-- Population requires a licensed DDI database (DrugBank, MIMS India, WHO DDI dataset).
-- The fn_check_interactions() function is ready and will activate once data is loaded.
-- Priority pairs to populate first: Warfarin+NSAIDs, MTX+NSAIDs, Lithium+NSAIDs,
-- Digoxin+Amiodarone, SSRI+Tramadol (serotonin syndrome).

CREATE TABLE drug_interactions (
  id              BIGSERIAL PRIMARY KEY,
  molecule_a_id   INTEGER       NOT NULL REFERENCES drug_molecules(id),
  molecule_b_id   INTEGER       NOT NULL REFERENCES drug_molecules(id),
  severity        severity_enum NOT NULL,
  mechanism       TEXT,
  clinical_effect TEXT,
  management      TEXT,
  evidence_level  CHAR(1)       CHECK (evidence_level IN ('A','B','C','D')),
  source          VARCHAR(200),
  created_at      TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT no_self_interaction
    CHECK (molecule_a_id != molecule_b_id),
  CONSTRAINT unique_drug_pair
    UNIQUE (LEAST(molecule_a_id, molecule_b_id), GREATEST(molecule_a_id, molecule_b_id))
);

COMMENT ON TABLE drug_interactions IS
  'Drug-drug interaction matrix. Bidirectional unique constraint prevents duplicate pairs. '
  'EMPTY at schema creation — populate with licensed DDI database. '
  'Use fn_check_interactions(molecule_ids[]) to query during prescription workflow.';


-- ── TABLE 5: DRUG SIDE EFFECTS ─────────────────────────────────────────────────
-- Frequency grading per EU SmPC standard. Molecule-level, not dose-specific.

CREATE TABLE drug_side_effects (
  id                   SERIAL PRIMARY KEY,
  molecule_id          INTEGER       NOT NULL REFERENCES drug_molecules(id),
  effect               TEXT          NOT NULL,
  frequency            VARCHAR(20)   CHECK (frequency IN (
                          'very_common',   -- >10%
                          'common',        -- 1–10%
                          'uncommon',      -- 0.1–1%
                          'rare',          -- 0.01–0.1%
                          'very_rare'      -- <0.01%
                        )),
  severity             VARCHAR(15)   CHECK (severity IN ('mild','moderate','severe','life_threatening')),
  is_black_box_warning BOOLEAN       DEFAULT FALSE,
  requires_monitoring  BOOLEAN       DEFAULT FALSE,
  monitoring_test      TEXT,
  created_at           TIMESTAMPTZ   DEFAULT NOW()
);


-- ── TABLE 6: DRUG MONITORING REQUIREMENTS ─────────────────────────────────────
-- Structured monitoring data enables automatic lab order prompts in prescription workflow.
-- "When Methotrexate selected → prompt LFT + CBC + Creatinine order"

CREATE TABLE drug_monitoring_requirements (
  id              SERIAL PRIMARY KEY,
  molecule_id     INTEGER                  NOT NULL REFERENCES drug_molecules(id),
  test_name       VARCHAR(100)             NOT NULL,
  frequency       VARCHAR(50),                        -- 'Before starting', 'Every 4 weeks'
  timing          monitoring_timing_enum   DEFAULT 'ongoing',
  is_mandatory    BOOLEAN                  DEFAULT FALSE,
  rationale       TEXT,
  icd10_lab_code  VARCHAR(20),                        -- For ABDM lab order integration
  created_at      TIMESTAMPTZ              DEFAULT NOW()
);

COMMENT ON TABLE drug_monitoring_requirements IS
  'Structured drug monitoring requirements. Enables automatic lab order prompting. '
  'Critical drugs requiring monitoring: Methotrexate (LFT/CBC), Lithium (Li level/TFT), '
  'Clozapine (WBC mandatory weekly x18 weeks), Warfarin (INR), Amiodarone (TFT/LFT/CXR).';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: VERSIONING & MIGRATION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 7: SPECIALTY PACK VERSIONS ──────────────────────────────────────────
-- Semantic versioning per specialty. Enables clinics to be notified of updates
-- and provides accountability trail (who reviewed, which guideline, when).

CREATE TABLE specialty_pack_versions (
  id                  SERIAL PRIMARY KEY,
  version_number      VARCHAR(10)   NOT NULL,        -- '2.0.0', '2.1.0'
  specialty           VARCHAR(100),                  -- NULL = applies to all specialties
  released_at         TIMESTAMPTZ   DEFAULT NOW(),
  release_notes       TEXT,
  breaking_changes    TEXT,                          -- Documents if drug removed or default changed
  is_current          BOOLEAN       DEFAULT FALSE,
  clinical_reviewer   VARCHAR(200),                  -- Name + NMC/MCI registration number
  review_institution  VARCHAR(200),
  review_date         DATE,
  guideline_source    VARCHAR(300),
  guideline_edition   VARCHAR(100),
  created_by          VARCHAR(100),

  CONSTRAINT uq_version_specialty UNIQUE (version_number, specialty)
);

INSERT INTO specialty_pack_versions
  (version_number, specialty, release_notes, is_current, guideline_source)
VALUES
  ('2.0.0', NULL,
   'Full schema rebuild. Addresses 70 audit findings. Normalized molecules, interactions, '
   'monitoring, AYUSH timing enums, banned drug guards, 3-tier customization, audit trails. '
   'Adds 14 specialty packs with 2100 drug rows.',
   TRUE,
   'ICMR 2023 National Essential Medicines List; WHO ATC 2024; CDSCO Drug Schedules 2023; '
   'NMC Digital Health Guidelines 2023')
ON CONFLICT DO NOTHING;


-- ── TABLE 8: SEED RUNS ─────────────────────────────────────────────────────────
-- Track every seed/migration run with outcome metrics.

CREATE TABLE seed_runs (
  id              SERIAL PRIMARY KEY,
  migration_file  VARCHAR(200)  NOT NULL,
  run_at          TIMESTAMPTZ   DEFAULT NOW(),
  run_by          VARCHAR(100),
  rows_inserted   INTEGER       DEFAULT 0,
  rows_skipped    INTEGER       DEFAULT 0,
  rows_failed     INTEGER       DEFAULT 0,
  environment     VARCHAR(20)   CHECK (environment IN ('development','staging','production')),
  pack_version    VARCHAR(10),
  checksum        VARCHAR(64),             -- SHA-256 of migration file for tamper detection
  notes           TEXT
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3: CORE DRUG PACK TABLE (REBUILT)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE specialty_starter_packs (
  id                        SERIAL PRIMARY KEY,

  -- ── IDENTITY ──
  specialty                 VARCHAR(100)           NOT NULL,
  rank                      INTEGER                NOT NULL,
  pack_version_id           INTEGER                REFERENCES specialty_pack_versions(id),

  -- ── DRUG IDENTITY ──
  -- drug_name: UPPERCASE per NMC mandate — display name shown to doctor
  -- molecule_id: FK to normalized molecule table — enables safety checks
  -- Both coexist to maintain display flexibility while enabling safety logic.
  -- molecule_id is NULLABLE for: v1 migration rows, procedures, AYUSH compounds
  drug_name                 VARCHAR(300)           NOT NULL,
  molecule_id               INTEGER                REFERENCES drug_molecules(id),
  generic_name              VARCHAR(200)           NOT NULL,

  -- ── PHARMACOLOGICAL CLASSIFICATION ──
  category                  VARCHAR(200),          -- Display/legacy; authoritative class via molecule FK

  -- ── DOSAGE (RESTRUCTURED) ──
  -- default_dosage: M-A-E shorthand ('1-1-1', '1-0-1') — kept for Indian Rx printing convention
  -- dosage_frequency_unit + dosage_interval_days: together fix the '0-0-0' weekly ambiguity
  -- See: DECISIONS.md Decision 3 for full rationale
  default_dosage            VARCHAR(20),
  dosage_frequency_unit     frequency_unit_enum    DEFAULT 'daily',
  dosage_interval_days      INTEGER                DEFAULT 1,
  default_duration          INTEGER                DEFAULT 0,    -- days; 0 = ongoing/indefinite
  default_timing            timing_enum            DEFAULT 'after_food',

  -- ── DOSE SAFETY GUARDRAILS ──
  -- Application reads these to warn doctor on override.
  -- Example: Paracetamol max_daily_dose_mg = 4000 (3000 in elderly with hepatic risk)
  max_daily_dose_mg         DECIMAL(10,3),
  max_duration_days         INTEGER,
  max_dose_warning_text     TEXT,

  -- ── ITEM CLASSIFICATION ──
  item_type                 item_type_enum         DEFAULT 'drug',

  -- ── SCHEDULE CLASSIFICATION ──
  -- Denormalized from drug_molecules for fast query access without JOIN.
  -- TODO: A trigger to sync schedule_class from drug_molecules is DEFERRED.
  -- Until implemented: when drug_molecules.schedule_class changes for a molecule,
  -- manually run: UPDATE specialty_starter_packs SET schedule_class = <new_value>
  --               WHERE molecule_id = <changed_molecule_id>;
  schedule_class            drug_schedule_enum,

  -- ── PEDIATRIC DOSING ──
  is_weight_based           BOOLEAN                DEFAULT FALSE,
  dosage_per_kg             DECIMAL(6,3),          -- mg/kg/dose
  max_pediatric_dose_mg     DECIMAL(8,2),          -- absolute ceiling
  max_single_dose_mg        DECIMAL(8,2),

  -- ── BEHAVIORAL FLAGS ──
  is_prn                    BOOLEAN                DEFAULT FALSE,    -- PRN / as-needed
  is_single_use             BOOLEAN                DEFAULT FALSE,    -- One-time use
  is_scheduled              BOOLEAN                DEFAULT TRUE,     -- Regular dosing
  requires_special_monitoring BOOLEAN              DEFAULT FALSE,

  -- ── CLINICAL CONTEXT ──
  clinical_indication       VARCHAR(300),          -- Why this drug is in this specialty pack
  contraindications         TEXT,
  interaction_alerts        TEXT[],

  -- ── GUIDELINE ATTRIBUTION ──
  guideline_source          VARCHAR(300),
  evidence_grade            evidence_grade_enum,
  last_clinical_review_date DATE,
  reviewed_by_clinician     VARCHAR(200),

  -- ── PRICING (INDIA-SPECIFIC) ──
  avg_mrp_inr               DECIMAL(8,2),
  jan_aushadhi_available    BOOLEAN                DEFAULT FALSE,
  jan_aushadhi_price_inr    DECIMAL(8,2),
  is_in_essential_medicines_list BOOLEAN           DEFAULT FALSE,
  price_last_updated        DATE,

  -- ── FEATURE GATING ──
  available_in_tier         feature_tier_enum      DEFAULT 'free',

  -- ── PATIENT COMMUNICATION ──
  -- Drug names in ALL-CAPS clinical format are not patient-friendly.
  -- These fields support the patient-facing prescription printout.
  patient_label             VARCHAR(200),          -- 'Blood pressure tablet'
  patient_instructions      TEXT,
  patient_instructions_hindi    TEXT,
  patient_instructions_marathi  TEXT,
  patient_instructions_tamil    TEXT,
  patient_instructions_telugu   TEXT,
  patient_instructions_kannada  TEXT,
  patient_instructions_gujarati TEXT,

  -- ── VISUAL IDENTIFICATION ──
  tablet_color              VARCHAR(50),
  tablet_shape              VARCHAR(50),
  pill_image_url            TEXT,
  packaging_image_url       TEXT,

  -- ── FHIR / ABDM INTEROPERABILITY ──
  -- Required for ABDM-compliant digital prescriptions (mandate by 2025)
  snomed_ct_code            VARCHAR(20),
  rxnorm_code               VARCHAR(20),
  who_atc_code              VARCHAR(10),
  icd10_indication_code     VARCHAR(10),
  fhir_medication_code      VARCHAR(50),

  -- ── SAFETY ALERTS ──
  recent_safety_alert       TEXT,
  safety_alert_date         DATE,
  cme_reference_url         TEXT,

  -- ── LIFECYCLE (SOFT DELETE + DEACTIVATION) ──
  -- Two mechanisms: is_active (temporarily unavailable) + deleted_at (logical delete)
  -- NEVER hard-delete — prescriptions may reference the row historically
  is_active                 BOOLEAN                DEFAULT TRUE,
  deactivated_at            TIMESTAMPTZ,
  deactivated_by            UUID,
  deactivated_reason        TEXT,
  deleted_at                TIMESTAMPTZ            DEFAULT NULL,
  deleted_by                UUID,
  deletion_reason           TEXT,

  -- ── AUDIT TIMESTAMPS ──
  created_at                TIMESTAMPTZ            DEFAULT NOW(),
  updated_at                TIMESTAMPTZ            DEFAULT NOW(),

  -- ── CONSTRAINTS ──
  CONSTRAINT uq_starter_specialty_rank
    UNIQUE (specialty, rank),
  CONSTRAINT uq_starter_specialty_drug
    UNIQUE (specialty, drug_name),
  CONSTRAINT chk_rank_positive
    CHECK (rank > 0),
  CONSTRAINT chk_duration_nonneg
    CHECK (default_duration >= 0),
  CONSTRAINT chk_interval_positive
    CHECK (dosage_interval_days > 0),
  CONSTRAINT chk_weight_based_has_per_kg
    CHECK (NOT is_weight_based OR dosage_per_kg IS NOT NULL),
  CONSTRAINT chk_soft_delete_reason
    CHECK (deleted_at IS NULL OR deletion_reason IS NOT NULL)
);

COMMENT ON TABLE specialty_starter_packs IS
  'Core drug starter pack table. Global, non-tenant-specific. '
  'Tenant customizations live in org_drug_overrides and doctor_drug_preferences. '
  'NEVER hard-delete rows — use soft-delete (deleted_at) for audit trail. '
  'Safety features (ban guard, interaction check) only activate when molecule_id IS NOT NULL.';

COMMENT ON COLUMN specialty_starter_packs.dosage_frequency_unit IS
  'Fixes the 0-0-0 weekly/monthly dosing ambiguity from v1. '
  'Alendronate 70mg weekly: default_dosage=''1-0-0'', frequency_unit=''weekly'', interval_days=7, duration=28.';

COMMENT ON COLUMN specialty_starter_packs.item_type IS
  'Separates prescribable drugs from procedures (PRP), dental materials (GIC), '
  'cosmetics (whitening gel), and devices (bandage lens). '
  'Prescription module should filter: WHERE item_type = ''drug''';

COMMENT ON COLUMN specialty_starter_packs.schedule_class IS
  'Denormalized from drug_molecules for fast query access. '
  'SYNC TRIGGER IS DEFERRED — see TODO note above. Update manually if molecule schedule changes.';

COMMENT ON COLUMN specialty_starter_packs.default_duration IS
  '0 = ongoing/indefinite (glaucoma drops, antihypertensives, antidiabetics). '
  'For weekly drugs this is in days (e.g., 28 = 4 weekly doses). '
  'Meaning is authoritative; use dosage_frequency_unit to interpret.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4: TENANT CUSTOMIZATION LAYER (3-TIER ARCHITECTURE)
-- Global defaults → Organization overrides → Doctor preferences
-- fn_get_specialty_drugs() merges all three tiers in one DB call.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 10: ORG DRUG OVERRIDES ──────────────────────────────────────────────
CREATE TABLE org_drug_overrides (
  id                  SERIAL PRIMARY KEY,
  org_id              UUID          NOT NULL,
  global_pack_id      INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  custom_rank         INTEGER,
  custom_dosage       VARCHAR(20),
  custom_duration     INTEGER,
  custom_timing       timing_enum,
  is_hidden           BOOLEAN       DEFAULT FALSE,
  is_restricted       BOOLEAN       DEFAULT FALSE,
  restriction_reason  TEXT,
  approved_by         VARCHAR(200),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_org_drug_override UNIQUE (org_id, global_pack_id)
);


-- ── TABLE 11: DOCTOR DRUG PREFERENCES ─────────────────────────────────────────
-- prescription_count and last_prescribed_at enable behavioral auto-ranking.
-- A doctor prescribing Telmisartan 40mg 95% of the time will see it at rank 1.

CREATE TABLE doctor_drug_preferences (
  id                    SERIAL PRIMARY KEY,
  doctor_id             UUID          NOT NULL,
  drug_pack_id          INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  personal_rank         INTEGER,
  personal_dosage       VARCHAR(20),
  personal_duration     INTEGER,
  personal_timing       timing_enum,
  is_pinned             BOOLEAN       DEFAULT FALSE,
  is_favorite           BOOLEAN       DEFAULT FALSE,
  is_hidden             BOOLEAN       DEFAULT FALSE,
  prescription_count    INTEGER       DEFAULT 0,
  last_prescribed_at    TIMESTAMPTZ,
  avg_duration_used     DECIMAL(5,1),
  most_common_dosage    VARCHAR(20),
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_doctor_drug UNIQUE (doctor_id, drug_pack_id)
);


-- ── TABLES 12A/12B: PRESCRIPTION TEMPLATES ────────────────────────────────────
CREATE TABLE prescription_templates (
  id                  SERIAL PRIMARY KEY,
  template_name       VARCHAR(200)  NOT NULL,
  specialty           VARCHAR(100),
  clinical_indication VARCHAR(300),
  description         TEXT,
  is_global           BOOLEAN       DEFAULT FALSE,
  org_id              UUID,
  doctor_id           UUID,
  use_count           INTEGER       DEFAULT 0,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT chk_template_scope
    CHECK (
      (is_global AND org_id IS NULL AND doctor_id IS NULL) OR
      (NOT is_global AND (org_id IS NOT NULL OR doctor_id IS NOT NULL))
    )
);

CREATE TABLE prescription_template_drugs (
  id                    SERIAL PRIMARY KEY,
  template_id           INTEGER       NOT NULL REFERENCES prescription_templates(id) ON DELETE CASCADE,
  drug_pack_id          INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  sequence_order        INTEGER       NOT NULL,
  dosage_override       VARCHAR(20),
  duration_override     INTEGER,
  timing_override       timing_enum,
  instructions_override TEXT,

  CONSTRAINT uq_template_drug    UNIQUE (template_id, drug_pack_id),
  CONSTRAINT chk_sequence_pos    CHECK (sequence_order > 0)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5: REGIONAL VARIATION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 13: REGIONAL DRUG VARIATIONS ────────────────────────────────────────
-- India's disease burden varies by region and season.
-- Antimalarials: critical in Assam/Odisha, rarely needed in Himachal Pradesh.
-- Dengue drugs: auto-promote in August–October in endemic states.

CREATE TABLE regional_drug_variations (
  id                  SERIAL PRIMARY KEY,
  drug_pack_id        INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  state_code          CHAR(2)       NOT NULL,         -- MH, DL, KA, TN, AS, etc.
  adjusted_rank       INTEGER,
  seasonal_relevance  VARCHAR(20)   CHECK (seasonal_relevance IN
                        ('monsoon','winter','summer','year_round','pre_monsoon')),
  peak_months         INTEGER[],                      -- [6,7,8,9] for monsoon
  prevalence_note     TEXT,
  created_at          TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_regional_drug UNIQUE (drug_pack_id, state_code)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6: ANALYTICS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 14: DRUG PRESCRIPTION ANALYTICS ─────────────────────────────────────
-- Time-bucketed with org and doctor dimensions.
-- date_bucket (month-truncated) enables seasonal pattern analysis and
-- post-guideline-update adoption tracking.

CREATE TABLE drug_prescription_analytics (
  id                      BIGSERIAL PRIMARY KEY,
  drug_pack_id            INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  org_id                  UUID,
  doctor_id               UUID,
  prescription_count      INTEGER       DEFAULT 0,
  last_prescribed_at      TIMESTAMPTZ,
  avg_duration_prescribed DECIMAL(5,1),
  most_common_dosage      VARCHAR(20),
  date_bucket             DATE          NOT NULL,
  state_code              CHAR(2),
  specialty_context       VARCHAR(100),
  created_at              TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_analytics_bucket UNIQUE (drug_pack_id, org_id, doctor_id, date_bucket)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7: AUDIT & COMPLIANCE
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 15: SPECIALTY PACK AUDIT LOG ────────────────────────────────────────
-- JSONB old/new values + session context. Trigger-based = cannot be bypassed
-- by direct SQL, migration scripts, or API bugs.
-- NEVER delete rows from this table.
-- Consider monthly partitioning by changed_at when rows exceed 10M.

CREATE TABLE specialty_pack_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  table_name      VARCHAR(50)       NOT NULL,
  row_id          INTEGER           NOT NULL,
  operation       operation_enum    NOT NULL,
  old_values      JSONB,
  new_values      JSONB,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ       DEFAULT NOW(),
  change_reason   TEXT,
  ip_address      INET,
  session_id      VARCHAR(100),
  user_agent      TEXT
);

COMMENT ON TABLE specialty_pack_audit_log IS
  'Immutable audit trail for all changes to drug pack data. '
  'Required for healthcare regulatory compliance. NEVER delete rows from this table. '
  'Partitioning by changed_at recommended once table exceeds 10M rows.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8: INDEXES
-- Strategy based on 4 primary query patterns:
--   1. specialty + rank (load drug list for a specialty)
--   2. drug name fuzzy search (autocomplete as doctor types)
--   3. generic name lookup (cross-specialty molecule lookup)
--   4. analytics (time-series by drug + org)
-- ═══════════════════════════════════════════════════════════════════════════

-- Primary lookup — specialty filtered, rank ordered, active only
CREATE INDEX idx_ssp_specialty_rank
  ON specialty_starter_packs (specialty, rank)
  WHERE deleted_at IS NULL AND is_active = TRUE;

-- Trigram fuzzy autocomplete: 'PARAC' → 'PARACETAMOL'
CREATE INDEX idx_ssp_drug_name_trgm
  ON specialty_starter_packs USING GIN (drug_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Full-text search combining drug_name + generic_name
CREATE INDEX idx_ssp_fts
  ON specialty_starter_packs
  USING GIN (to_tsvector('english', drug_name || ' ' || generic_name))
  WHERE deleted_at IS NULL;

-- Generic name cross-specialty lookup
CREATE INDEX idx_ssp_generic_name
  ON specialty_starter_packs (generic_name)
  WHERE deleted_at IS NULL;

-- Molecule linkage
CREATE INDEX idx_ssp_molecule_id
  ON specialty_starter_packs (molecule_id)
  WHERE molecule_id IS NOT NULL;

-- Schedule class (H1/X drug special handling, Rx display logic)
CREATE INDEX idx_ssp_schedule
  ON specialty_starter_packs (schedule_class)
  WHERE schedule_class IS NOT NULL;

-- Item type filter (prescription module: WHERE item_type = 'drug')
CREATE INDEX idx_ssp_item_type
  ON specialty_starter_packs (item_type);

-- Analytics queries
CREATE INDEX idx_analytics_drug_bucket
  ON drug_prescription_analytics (drug_pack_id, date_bucket DESC);
CREATE INDEX idx_analytics_doctor_bucket
  ON drug_prescription_analytics (doctor_id, date_bucket DESC)
  WHERE doctor_id IS NOT NULL;
CREATE INDEX idx_analytics_org_bucket
  ON drug_prescription_analytics (org_id, date_bucket DESC)
  WHERE org_id IS NOT NULL;

-- Audit log lookups
CREATE INDEX idx_audit_row_id
  ON specialty_pack_audit_log (table_name, row_id, changed_at DESC);
CREATE INDEX idx_audit_changed_by
  ON specialty_pack_audit_log (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

-- Interactions (bidirectional — both directions indexed)
CREATE INDEX idx_interaction_mol_a ON drug_interactions (molecule_a_id, severity);
CREATE INDEX idx_interaction_mol_b ON drug_interactions (molecule_b_id, severity);

-- Monitoring requirements
CREATE INDEX idx_monitoring_molecule
  ON drug_monitoring_requirements (molecule_id, is_mandatory);

-- Regional variations
CREATE INDEX idx_regional_state
  ON regional_drug_variations (state_code, seasonal_relevance);

-- Doctor preferences — pinned drugs fast lookup
CREATE INDEX idx_doctor_pref_pinned
  ON doctor_drug_preferences (doctor_id, is_pinned, personal_rank)
  WHERE is_hidden = FALSE;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 9: MATERIALIZED VIEW (AUTOCOMPLETE CACHE)
-- Pre-computes the most expensive join.
-- At 50 concurrent doctors × 1 keystroke/sec = 50 3-table JOINs/sec without cache.
-- CONCURRENTLY refresh means reads never block during refresh.
-- Recommended refresh: every 15 min during clinic hours via pg_cron.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW specialty_drug_cache AS
SELECT
  ssp.id,
  ssp.specialty,
  ssp.rank,
  ssp.drug_name,
  ssp.generic_name,
  ssp.category,
  ssp.default_dosage,
  ssp.dosage_frequency_unit,
  ssp.dosage_interval_days,
  ssp.default_duration,
  ssp.default_timing,
  ssp.item_type,
  ssp.schedule_class,
  ssp.is_prn,
  ssp.is_single_use,
  ssp.is_weight_based,
  ssp.dosage_per_kg,
  ssp.clinical_indication,
  ssp.available_in_tier,
  ssp.jan_aushadhi_available,
  ssp.avg_mrp_inr,
  ssp.requires_special_monitoring,
  ssp.patient_label,
  ssp.max_daily_dose_mg,
  ssp.max_duration_days,
  -- Safety data from drug_molecules (null-safe via LEFT JOIN)
  dm.pregnancy_category,
  dm.is_narrow_therapeutic_index,
  dm.requires_renal_adjustment,
  dm.requires_hepatic_adjustment,
  dm.use_caution_elderly,
  dm.is_banned_india,
  dm.cdsco_approval_status,
  dm.allergy_class_id,
  -- Therapeutic group from ATC table
  tg.group_name   AS therapeutic_group,
  tg.atc_code     AS therapeutic_group_atc
FROM specialty_starter_packs ssp
LEFT JOIN drug_molecules     dm  ON dm.id  = ssp.molecule_id
LEFT JOIN therapeutic_groups tg  ON tg.id  = dm.therapeutic_group_id
WHERE ssp.deleted_at IS NULL
  AND ssp.is_active = TRUE;

CREATE UNIQUE INDEX ON specialty_drug_cache (specialty, rank);
CREATE INDEX ON specialty_drug_cache USING GIN (drug_name gin_trgm_ops);
CREATE INDEX ON specialty_drug_cache
  USING GIN (to_tsvector('english', drug_name || ' ' || generic_name));

COMMENT ON MATERIALIZED VIEW specialty_drug_cache IS
  'Pre-computed join: specialty_starter_packs + drug_molecules + therapeutic_groups. '
  'Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY specialty_drug_cache; '
  'pg_cron schedule: every 15 min 08:00-20:00, nightly 02:00 full rebuild.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 10: FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TRIGGER 1: Auto-update updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ssp_updated_at
  BEFORE UPDATE ON specialty_starter_packs
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_org_override_updated_at
  BEFORE UPDATE ON org_drug_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_doctor_pref_updated_at
  BEFORE UPDATE ON doctor_drug_preferences
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_molecule_updated_at
  BEFORE UPDATE ON drug_molecules
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();


-- ── TRIGGER 2: Audit log for specialty_starter_packs ──────────────────────────
-- Trigger-based (not application-level) so it catches ALL writes: direct SQL,
-- migrations, admin tools — not just application-layer changes.

CREATE OR REPLACE FUNCTION fn_log_ssp_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO specialty_pack_audit_log (
    table_name, row_id, operation,
    old_values, new_values,
    changed_at, session_id
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP::operation_enum,
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    NOW(),
    current_setting('app.session_id', TRUE)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_ssp_audit
  AFTER INSERT OR UPDATE OR DELETE ON specialty_starter_packs
  FOR EACH ROW EXECUTE FUNCTION fn_log_ssp_changes();


-- ── TRIGGER 3: Banned Drug Guard ───────────────────────────────────────────────
-- DB-level hard block: physically impossible to INSERT a CDSCO-banned drug.
-- Only fires when molecule_id IS NOT NULL (grace period for un-linked rows).
-- Once all rows are linked, consider making molecule_id NOT NULL.

CREATE OR REPLACE FUNCTION fn_prevent_banned_drug()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_banned     BOOLEAN;
  v_status     cdsco_status_enum;
  v_inn_name   VARCHAR(200);
BEGIN
  IF NEW.molecule_id IS NOT NULL THEN
    SELECT is_banned_india, cdsco_approval_status, inn_name
    INTO   v_banned, v_status, v_inn_name
    FROM   drug_molecules
    WHERE  id = NEW.molecule_id;

    IF v_banned = TRUE THEN
      RAISE EXCEPTION
        'BANNED DRUG BLOCKED: % (molecule_id: %) is banned in India by CDSCO. '
        'Reference: drug_molecules.ban_gazette_notification.',
        v_inn_name, NEW.molecule_id;
    END IF;

    IF v_status IN ('withdrawn', 'suspended') THEN
      RAISE WARNING
        'Drug % has CDSCO status: %. Row inserted with caution flag. '
        'Review clinical necessity before prescribing.',
        v_inn_name, v_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_banned_drug
  BEFORE INSERT OR UPDATE ON specialty_starter_packs
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_banned_drug();


-- ── FUNCTION: Get drug list for specialty (3-tier resolution) ──────────────────
-- Returns fully merged drug list: Global defaults → Org overrides → Doctor preferences.
-- Pinned drugs surface first. Hidden drugs excluded. Single DB call, no app-layer merging.

CREATE OR REPLACE FUNCTION fn_get_specialty_drugs(
  p_specialty   VARCHAR(100),
  p_org_id      UUID    DEFAULT NULL,
  p_doctor_id   UUID    DEFAULT NULL,
  p_tier        TEXT    DEFAULT 'free'
)
RETURNS TABLE (
  drug_pack_id       INTEGER,
  drug_name          VARCHAR(300),
  generic_name       VARCHAR(200),
  effective_rank     INTEGER,
  effective_dosage   VARCHAR(20),
  effective_duration INTEGER,
  effective_timing   timing_enum,
  is_hidden          BOOLEAN,
  is_pinned          BOOLEAN,
  source_tier        TEXT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH global_drugs AS (
    SELECT
      ssp.id,
      ssp.drug_name,
      ssp.generic_name,
      ssp.rank,
      ssp.default_dosage,
      ssp.default_duration,
      ssp.default_timing,
      ssp.available_in_tier
    FROM specialty_starter_packs ssp
    WHERE ssp.specialty = p_specialty
      AND ssp.deleted_at IS NULL
      AND ssp.is_active = TRUE
      AND (p_tier = 'enterprise' OR
           p_tier = 'pro'        OR
           ssp.available_in_tier = 'free')
  ),
  with_org AS (
    SELECT
      g.id,
      g.drug_name,
      g.generic_name,
      COALESCE(o.custom_rank,     g.rank)           AS effective_rank,
      COALESCE(o.custom_dosage,   g.default_dosage)  AS effective_dosage,
      COALESCE(o.custom_duration, g.default_duration) AS effective_duration,
      COALESCE(o.custom_timing,   g.default_timing)  AS effective_timing,
      COALESCE(o.is_hidden, FALSE)                   AS org_hidden,
      CASE WHEN o.id IS NOT NULL THEN 'org' ELSE 'global' END AS source
    FROM global_drugs g
    LEFT JOIN org_drug_overrides o
      ON o.global_pack_id = g.id AND o.org_id = p_org_id
  )
  SELECT
    w.id,
    w.drug_name,
    w.generic_name,
    COALESCE(d.personal_rank,     w.effective_rank)    AS effective_rank,
    COALESCE(d.personal_dosage,   w.effective_dosage)  AS effective_dosage,
    COALESCE(d.personal_duration, w.effective_duration) AS effective_duration,
    COALESCE(d.personal_timing,   w.effective_timing)  AS effective_timing,
    COALESCE(d.is_hidden, w.org_hidden)                AS is_hidden,
    COALESCE(d.is_pinned, FALSE)                       AS is_pinned,
    CASE WHEN d.id IS NOT NULL THEN 'doctor' ELSE w.source END AS source_tier
  FROM with_org w
  LEFT JOIN doctor_drug_preferences d
    ON d.drug_pack_id = w.id AND d.doctor_id = p_doctor_id
  WHERE COALESCE(d.is_hidden, w.org_hidden) = FALSE
  ORDER BY
    COALESCE(d.is_pinned, FALSE) DESC,
    COALESCE(d.personal_rank, w.effective_rank) ASC;
END;
$$;

COMMENT ON FUNCTION fn_get_specialty_drugs IS
  'Returns fully merged drug list (Global → Org → Doctor). '
  'Usage: SELECT * FROM fn_get_specialty_drugs(''Cardiologist'', org_uuid, doctor_uuid, ''pro'');';


-- ── FUNCTION: Refresh materialized view ────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_refresh_drug_cache()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY specialty_drug_cache;
  INSERT INTO seed_runs (migration_file, rows_inserted, environment, notes)
  VALUES ('fn_refresh_drug_cache', 0, 'production', 'Materialized view refreshed by pg_cron');
END;
$$;

-- Schedule with pg_cron (configure once per environment):
-- SELECT cron.schedule('refresh-drug-cache-day',   '*/15 8-20 * * *', 'SELECT fn_refresh_drug_cache()');
-- SELECT cron.schedule('refresh-drug-cache-night',  '0 2 * * *',       'SELECT fn_refresh_drug_cache()');


-- ── FUNCTION: Check drug interactions ─────────────────────────────────────────
-- Takes an array of molecule_ids (from current prescription) and returns
-- all interaction pairs within that set, ordered by severity.
-- Returns empty set until drug_interactions table is populated with DDI data.

CREATE OR REPLACE FUNCTION fn_check_interactions(p_molecule_ids INTEGER[])
RETURNS TABLE (
  molecule_a_name  VARCHAR(200),
  molecule_b_name  VARCHAR(200),
  severity         severity_enum,
  clinical_effect  TEXT,
  management       TEXT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ma.inn_name  AS molecule_a_name,
    mb.inn_name  AS molecule_b_name,
    di.severity,
    di.clinical_effect,
    di.management
  FROM drug_interactions di
  JOIN drug_molecules ma ON ma.id = di.molecule_a_id
  JOIN drug_molecules mb ON mb.id = di.molecule_b_id
  WHERE di.molecule_a_id = ANY(p_molecule_ids)
    AND di.molecule_b_id = ANY(p_molecule_ids)
  ORDER BY
    CASE di.severity
      WHEN 'contraindicated' THEN 1
      WHEN 'major'           THEN 2
      WHEN 'moderate'        THEN 3
      WHEN 'minor'           THEN 4
    END;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 11: ROW LEVEL SECURITY
-- RLS as defense-in-depth for multi-tenant isolation.
-- Even if application code has a bug, one clinic cannot see another's data.
-- Requires connection pool in SESSION mode (not transaction mode) with:
--   SET LOCAL app.org_id = 'uuid'; SET LOCAL app.doctor_id = 'uuid';
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE specialty_starter_packs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_drug_overrides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_drug_preferences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_prescription_analytics  ENABLE ROW LEVEL SECURITY;

-- Global pack: all authenticated users can read; only superadmin/clinical_admin can write
CREATE POLICY ssp_read_all ON specialty_starter_packs
  FOR SELECT TO PUBLIC USING (TRUE);

CREATE POLICY ssp_write_superadmin ON specialty_starter_packs
  FOR ALL
  USING (current_setting('app.user_role', TRUE) IN ('superadmin', 'clinical_admin'));

-- Org overrides: scoped to current org session
CREATE POLICY org_override_scoped ON org_drug_overrides
  FOR ALL
  USING (org_id = current_setting('app.org_id', TRUE)::UUID);

-- Doctor preferences: scoped to current doctor session
CREATE POLICY doctor_pref_scoped ON doctor_drug_preferences
  FOR ALL
  USING (doctor_id = current_setting('app.doctor_id', TRUE)::UUID);

-- Analytics: org can see their own; doctor can see their own
CREATE POLICY analytics_org_scoped ON drug_prescription_analytics
  FOR SELECT
  USING (
    org_id    = current_setting('app.org_id',    TRUE)::UUID OR
    doctor_id = current_setting('app.doctor_id', TRUE)::UUID
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 12: APPLICATION VIEWS
-- ═══════════════════════════════════════════════════════════════════════════

-- View: Active drugs with full safety context (for prescription workflow)
CREATE OR REPLACE VIEW vw_active_drugs_with_safety AS
SELECT
  ssp.id, ssp.specialty, ssp.rank, ssp.drug_name, ssp.generic_name,
  ssp.category, ssp.item_type, ssp.schedule_class,
  ssp.default_dosage, ssp.dosage_frequency_unit, ssp.dosage_interval_days,
  ssp.default_duration, ssp.default_timing,
  ssp.is_prn, ssp.is_single_use, ssp.is_weight_based,
  ssp.clinical_indication, ssp.available_in_tier,
  ssp.jan_aushadhi_available, ssp.avg_mrp_inr,
  dm.pregnancy_category, dm.is_narrow_therapeutic_index,
  dm.requires_renal_adjustment, dm.requires_hepatic_adjustment,
  dm.use_caution_elderly, dm.schedule_class AS molecule_schedule,
  dm.min_age_years, dm.max_age_years,
  dac.class_name AS allergy_class,
  tg.group_name  AS therapeutic_group,
  tg.atc_code
FROM specialty_starter_packs ssp
LEFT JOIN drug_molecules       dm  ON dm.id  = ssp.molecule_id
LEFT JOIN drug_allergy_classes dac ON dac.id = dm.allergy_class_id
LEFT JOIN therapeutic_groups   tg  ON tg.id  = dm.therapeutic_group_id
WHERE ssp.deleted_at IS NULL AND ssp.is_active = TRUE;

-- View: Drugs requiring monitoring (for prescription workflow prompt)
CREATE OR REPLACE VIEW vw_drugs_requiring_monitoring AS
SELECT
  ssp.specialty, ssp.drug_name, ssp.generic_name,
  dmr.test_name, dmr.frequency, dmr.timing,
  dmr.is_mandatory, dmr.rationale
FROM specialty_starter_packs ssp
JOIN drug_monitoring_requirements dmr ON dmr.molecule_id = ssp.molecule_id
WHERE ssp.deleted_at IS NULL AND ssp.is_active = TRUE
ORDER BY ssp.specialty, ssp.rank, dmr.is_mandatory DESC;

-- View: Major/contraindicated interactions within same specialty
-- NOTE: Returns no rows until drug_interactions table is populated with DDI data.
CREATE OR REPLACE VIEW vw_intraspecialty_interactions AS
SELECT
  ssp_a.specialty,
  ssp_a.drug_name AS drug_a,
  ssp_b.drug_name AS drug_b,
  di.severity,
  di.clinical_effect,
  di.management
FROM drug_interactions di
JOIN specialty_starter_packs ssp_a ON ssp_a.molecule_id = di.molecule_a_id
JOIN specialty_starter_packs ssp_b ON ssp_b.molecule_id = di.molecule_b_id
WHERE ssp_a.specialty = ssp_b.specialty
  AND di.severity IN ('major', 'contraindicated')
  AND ssp_a.deleted_at IS NULL
  AND ssp_b.deleted_at IS NULL
ORDER BY ssp_a.specialty, di.severity;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 13: POST-SEED VALIDATION QUERIES
-- Run these after each seed to verify data integrity.
-- Expected result for EACH query: 0 rows.
-- Include in CI/CD pipeline as automated tests.
-- ═══════════════════════════════════════════════════════════════════════════

/*
── V1: No duplicate (specialty, rank) pairs ─────────────────────────────────
SELECT specialty, rank, COUNT(*)
FROM specialty_starter_packs
GROUP BY specialty, rank
HAVING COUNT(*) > 1;

── V2: No banned drugs in active packs ───────────────────────────────────────
SELECT ssp.drug_name, ssp.specialty, dm.ban_gazette_notification
FROM specialty_starter_packs ssp
JOIN drug_molecules dm ON dm.id = ssp.molecule_id
WHERE dm.is_banned_india = TRUE AND ssp.deleted_at IS NULL;

── V3: No invalid timing values ──────────────────────────────────────────────
SELECT id, drug_name, default_timing
FROM specialty_starter_packs
WHERE default_timing::TEXT NOT IN (
  'after_food','before_food','empty_stomach','with_milk',
  'with_warm_water','with_honey','with_ghee',
  'with_warm_water_before_food','with_juice','sublingual','as_directed'
);

── V4: No negative durations ─────────────────────────────────────────────────
SELECT drug_name, default_duration
FROM specialty_starter_packs
WHERE default_duration < 0;

── V5: Weight-based drugs must have dosage_per_kg ────────────────────────────
SELECT drug_name, specialty
FROM specialty_starter_packs
WHERE is_weight_based = TRUE AND dosage_per_kg IS NULL;

── V6: Schedule H1 drugs — default duration must not exceed 30 days ──────────
SELECT drug_name, schedule_class, default_duration
FROM specialty_starter_packs
WHERE schedule_class = 'H1'
  AND default_duration > 30
  AND dosage_frequency_unit = 'daily';

── V7: All specialties must have exactly 150 active rows ─────────────────────
SELECT specialty, COUNT(*) AS drug_count,
  CASE WHEN COUNT(*) = 150 THEN 'OK' ELSE 'INCOMPLETE' END AS status
FROM specialty_starter_packs
WHERE deleted_at IS NULL AND is_active = TRUE
GROUP BY specialty
ORDER BY status DESC, specialty;

── V8: Procedures/materials must not be marked as scheduled drugs ─────────────
SELECT drug_name, item_type, is_scheduled
FROM specialty_starter_packs
WHERE item_type IN ('procedure','material','cosmetic','device')
  AND is_scheduled = TRUE;

── V9: AYUSH timing values only used with AYUSH item_type ────────────────────
SELECT drug_name, item_type, default_timing
FROM specialty_starter_packs
WHERE default_timing IN ('with_milk','with_honey','with_ghee','with_warm_water')
  AND item_type != 'ayush';

── V10: Each specialty's ranks must be sequential (no gaps) ──────────────────
SELECT specialty,
  MAX(rank) AS max_rank,
  COUNT(*)  AS actual_count,
  CASE WHEN MAX(rank) = COUNT(*) THEN 'SEQUENTIAL' ELSE 'HAS GAPS' END AS status
FROM specialty_starter_packs
WHERE deleted_at IS NULL
GROUP BY specialty
HAVING MAX(rank) != COUNT(*);

── V11: PRN drugs should have dosage_frequency_unit = 'sos' ──────────────────
SELECT drug_name, specialty, is_prn, dosage_frequency_unit
FROM specialty_starter_packs
WHERE is_prn = TRUE AND dosage_frequency_unit != 'sos';

── V12: Weekly drugs should have dosage_interval_days = 7 ────────────────────
SELECT drug_name, specialty, dosage_frequency_unit, dosage_interval_days
FROM specialty_starter_packs
WHERE dosage_frequency_unit = 'weekly' AND dosage_interval_days != 7;
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- FINALIZE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO seed_runs (migration_file, environment, pack_version, notes, rows_inserted)
VALUES (
  '001_clinicflow_v2_schema.sql',
  'development',
  '2.0.0',
  'Schema created. 15 tables, 3 views, 1 materialized view, 5 triggers, 3 functions, RLS. '
  'Run 002_clinicflow_v2_seed.sql next to populate specialty drug packs.',
  0
);

COMMIT;

-- ── POST-COMMIT: Refresh materialized view (cannot run inside transaction) ────
-- Run manually after 002_seed.sql completes:
-- REFRESH MATERIALIZED VIEW specialty_drug_cache;



sql

-- ============================================================
-- ClinicFlow — Data Fixes + Remaining 10 Specialty Packs
-- Run AFTER 001_initial_schema.sql AND 002_starter_packs.sql
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- PART A: FIXES — BAD DATA IN EXISTING 600 ROWS
-- ═══════════════════════════════════════════════════════════

-- Fix 1: RANITIDINE 150MG (General Physician, rank 59)
-- CDSCO withdrew ranitidine in April 2020 (NDMA contamination).
-- Replaced with FAMOTIDINE 20MG — same H2 blocker class, currently approved.
UPDATE specialty_starter_packs
SET drug_name = 'FAMOTIDINE 20MG', generic_name = 'Famotidine', category = 'H2 Blocker'
WHERE specialty = 'General Physician' AND rank = 59 AND drug_name = 'RANITIDINE 150MG';

-- Fix 2: RANITIDINE SYRUP 15MG/ML (Pediatrician, rank 57) — same withdrawal.
-- Replaced with FAMOTIDINE SUSPENSION 10MG/5ML.
UPDATE specialty_starter_packs
SET drug_name = 'FAMOTIDINE SUSPENSION 10MG/5ML', generic_name = 'Famotidine', category = 'H2 Blocker'
WHERE specialty = 'Pediatrician' AND rank = 57 AND drug_name = 'RANITIDINE SYRUP 15MG/ML';

-- Fix 3: VITAMIN D3 60000IU (General Physician, rank 42)
-- default_dosage = '0-0-0' = zero doses (meaningless). Duration 4 = ambiguous.
-- Actual instruction: one sachet/week × 4 weeks. Fixed: 1-0-0, duration 28 days.
UPDATE specialty_starter_packs
SET default_dosage = '1-0-0', default_duration = 28
WHERE specialty = 'General Physician' AND rank = 42 AND drug_name = 'VITAMIN D3 60000IU';

-- Fix 4: VITAMIN D3 60000IU (Dermatologist, rank 71) — same 0-0-0 problem.
UPDATE specialty_starter_packs
SET default_dosage = '1-0-0', default_duration = 28
WHERE specialty = 'Dermatologist' AND rank = 71 AND drug_name = 'VITAMIN D3 60000IU';

-- Fix 5: CHOLECALCIFEROL 60000IU SACHET (Pediatrician, rank 54)
-- duration = 4 implies 4 consecutive days. Actual: 4 weekly doses = 28 days.
UPDATE specialty_starter_packs
SET default_duration = 28
WHERE specialty = 'Pediatrician' AND rank = 54 AND drug_name = 'CHOLECALCIFEROL 60000IU SACHET';

-- Fix 6: METHYLPHENIDATE 5MG (Pediatrician, rank 79)
-- Methylphenidate is a Schedule X psychotropic under NDPS Act in India.
-- Starter pack must not include Schedule X drugs (Decision #53, banned drug guard).
-- Replaced with ATOMOXETINE 18MG — non-stimulant, Schedule H, safe for starter pack.
UPDATE specialty_starter_packs
SET drug_name = 'ATOMOXETINE 18MG', generic_name = 'Atomoxetine', category = 'SNRI/ADHD'
WHERE specialty = 'Pediatrician' AND rank = 79 AND drug_name = 'METHYLPHENIDATE 5MG';


-- ═══════════════════════════════════════════════════════════
-- PART B: ORTHOPEDIC (150 rows)
-- ═══════════════════════════════════════════════════════════
INSERT INTO specialty_starter_packs(specialty, rank, drug_name, generic_name, category, default_dosage, default_duration, default_timing) VALUES
('Orthopedic',1,'PARACETAMOL 500MG','Paracetamol','Analgesic/Antipyretic','1-1-1',5,'after_food'),
('Orthopedic',2,'PARACETAMOL 650MG','Paracetamol','Analgesic/Antipyretic','1-1-1',5,'after_food'),
('Orthopedic',3,'IBUPROFEN 400MG','Ibuprofen','NSAID','1-1-1',5,'after_food'),
('Orthopedic',4,'IBUPROFEN 600MG','Ibuprofen','NSAID','1-1-1',5,'after_food'),
('Orthopedic',5,'DICLOFENAC 50MG','Diclofenac','NSAID','1-1-1',5,'after_food'),
('Orthopedic',6,'DICLOFENAC 75MG SR','Diclofenac','NSAID SR','1-0-1',10,'after_food'),
('Orthopedic',7,'ACECLOFENAC 100MG','Aceclofenac','NSAID','1-0-1',7,'after_food'),
('Orthopedic',8,'NAPROXEN 250MG','Naproxen','NSAID','1-1-1',7,'after_food'),
('Orthopedic',9,'NAPROXEN 500MG','Naproxen','NSAID','1-0-1',7,'after_food'),
('Orthopedic',10,'ETORICOXIB 60MG','Etoricoxib','COX-2 Inhibitor','1-0-0',14,'after_food'),
('Orthopedic',11,'ETORICOXIB 90MG','Etoricoxib','COX-2 Inhibitor','1-0-0',7,'after_food'),
('Orthopedic',12,'ETORICOXIB 120MG','Etoricoxib','COX-2 Inhibitor Acute','1-0-0',5,'after_food'),
('Orthopedic',13,'CELECOXIB 100MG','Celecoxib','COX-2 Inhibitor','1-0-1',14,'after_food'),
('Orthopedic',14,'CELECOXIB 200MG','Celecoxib','COX-2 Inhibitor','1-0-0',14,'after_food'),
('Orthopedic',15,'MELOXICAM 7.5MG','Meloxicam','COX-2 Preferential NSAID','1-0-0',14,'after_food'),
('Orthopedic',16,'MELOXICAM 15MG','Meloxicam','COX-2 Preferential NSAID','1-0-0',14,'after_food'),
('Orthopedic',17,'LORNOXICAM 8MG','Lornoxicam','NSAID','1-0-1',5,'after_food'),
('Orthopedic',18,'NIMESULIDE 100MG','Nimesulide','NSAID','1-0-1',5,'after_food'),
('Orthopedic',19,'INDOMETHACIN 25MG','Indomethacin','NSAID','1-1-1',7,'after_food'),
('Orthopedic',20,'INDOMETHACIN 75MG SR','Indomethacin','NSAID SR','1-0-0',7,'after_food'),
('Orthopedic',21,'MEFENAMIC ACID 500MG','Mefenamic Acid','NSAID','1-1-1',5,'after_food'),
('Orthopedic',22,'ETODOLAC 400MG','Etodolac','COX-2 Preferential NSAID','1-0-1',14,'after_food'),
('Orthopedic',23,'PIROXICAM 20MG','Piroxicam','NSAID','1-0-0',14,'after_food'),
('Orthopedic',24,'KETOROLAC 10MG','Ketorolac','NSAID/Analgesic','1-1-1',5,'after_food'),
('Orthopedic',25,'DEXIBUPROFEN 300MG','Dexibuprofen','NSAID','1-0-1',7,'after_food'),
('Orthopedic',26,'ACECLOFENAC 100MG + PARACETAMOL 325MG','Aceclofenac + Paracetamol','NSAID + Analgesic Combination','1-0-1',5,'after_food'),
('Orthopedic',27,'DICLOFENAC 50MG + PARACETAMOL 500MG','Diclofenac + Paracetamol','NSAID + Analgesic Combination','1-0-1',5,'after_food'),
('Orthopedic',28,'TRAMADOL 50MG + PARACETAMOL 325MG','Tramadol + Paracetamol','Opioid + Analgesic Combination','1-0-1',5,'after_food'),
('Orthopedic',29,'ETORICOXIB 60MG + THIOCOLCHICOSIDE 4MG','Etoricoxib + Thiocolchicoside','COX-2 + Muscle Relaxant Combination','1-0-1',7,'after_food'),
('Orthopedic',30,'ACECLOFENAC + THIOCOLCHICOSIDE','Aceclofenac + Thiocolchicoside','NSAID + Muscle Relaxant Combination','1-0-1',5,'after_food'),
('Orthopedic',31,'DICLOFENAC 75MG INJ','Diclofenac','Injectable NSAID','1-0-1',3,'after_food'),
('Orthopedic',32,'KETOROLAC 30MG INJ','Ketorolac','Injectable NSAID/Analgesic','1-0-1',3,'after_food'),
('Orthopedic',33,'PARACETAMOL 1GM IV INJ','Paracetamol','IV Analgesic/Antipyretic','1-1-1',2,'after_food'),
('Orthopedic',34,'TRAMADOL 50MG','Tramadol','Opioid Analgesic','1-1-1',5,'after_food'),
('Orthopedic',35,'TRAMADOL 100MG SR','Tramadol','Opioid Analgesic SR','1-0-1',7,'after_food'),
('Orthopedic',36,'TAPENTADOL 50MG','Tapentadol','Opioid Analgesic','1-1-1',5,'after_food'),
('Orthopedic',37,'TAPENTADOL 100MG SR','Tapentadol','Opioid Analgesic SR','1-0-1',7,'after_food'),
('Orthopedic',38,'THIOCOLCHICOSIDE 4MG','Thiocolchicoside','Muscle Relaxant','1-0-1',7,'after_food'),
('Orthopedic',39,'THIOCOLCHICOSIDE 8MG','Thiocolchicoside','Muscle Relaxant','1-0-1',7,'after_food'),
('Orthopedic',40,'METHOCARBAMOL 750MG','Methocarbamol','Muscle Relaxant','1-1-1',7,'after_food'),
('Orthopedic',41,'CHLORZOXAZONE 250MG','Chlorzoxazone','Muscle Relaxant','1-1-1',7,'after_food'),
('Orthopedic',42,'TIZANIDINE 2MG','Tizanidine','Central Muscle Relaxant','0-0-1',14,'after_food'),
('Orthopedic',43,'TIZANIDINE 4MG','Tizanidine','Central Muscle Relaxant','0-0-1',14,'after_food'),
('Orthopedic',44,'BACLOFEN 10MG','Baclofen','Central Muscle Relaxant','1-0-1',30,'after_food'),
('Orthopedic',45,'BACLOFEN 25MG','Baclofen','Central Muscle Relaxant','1-0-1',30,'after_food'),
('Orthopedic',46,'CYCLOBENZAPRINE 5MG','Cyclobenzaprine','Muscle Relaxant','1-1-1',7,'after_food'),
('Orthopedic',47,'TOLPERISONE 150MG','Tolperisone','Central Muscle Relaxant','1-1-1',14,'after_food'),
('Orthopedic',48,'ORPHENADRINE 100MG','Orphenadrine','Anticholinergic Muscle Relaxant','1-0-1',7,'after_food'),
('Orthopedic',49,'GABAPENTIN 100MG','Gabapentin','Anticonvulsant/Neuropathic','0-0-1',30,'after_food'),
('Orthopedic',50,'GABAPENTIN 300MG','Gabapentin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Orthopedic',51,'GABAPENTIN 400MG','Gabapentin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Orthopedic',52,'PREGABALIN 75MG','Pregabalin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Orthopedic',53,'PREGABALIN 150MG','Pregabalin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Orthopedic',54,'AMITRIPTYLINE 10MG','Amitriptyline','TCA/Neuropathic Pain','0-0-1',30,'after_food'),
('Orthopedic',55,'DULOXETINE 30MG','Duloxetine','SNRI/Neuropathic Pain','1-0-0',30,'after_food'),
('Orthopedic',56,'DULOXETINE 60MG','Duloxetine','SNRI/Neuropathic Pain','1-0-0',30,'after_food'),
('Orthopedic',57,'METHYLCOBALAMIN 500MCG','Methylcobalamin','Vitamin B12/Neuroprotective','1-0-1',30,'after_food'),
('Orthopedic',58,'ALPHA LIPOIC ACID 600MG','Alpha Lipoic Acid','Antioxidant/Neuropathic','1-0-0',30,'after_food'),
('Orthopedic',59,'CALCIUM CARBONATE 500MG + D3','Calcium Carbonate + Cholecalciferol','Calcium Supplement','1-0-1',30,'after_food'),
('Orthopedic',60,'CALCIUM CARBONATE 1000MG + D3','Calcium Carbonate + Cholecalciferol','Calcium Supplement','1-0-1',30,'after_food'),
('Orthopedic',61,'VITAMIN D3 60000IU','Cholecalciferol','Vitamin D Weekly','1-0-0',28,'after_food'),
('Orthopedic',62,'VITAMIN D3 2000IU','Cholecalciferol','Vitamin D Maintenance','1-0-0',90,'after_food'),
('Orthopedic',63,'ALFACALCIDOL 0.5MCG','Alfacalcidol','Active Vitamin D','1-0-0',30,'after_food'),
('Orthopedic',64,'CALCITRIOL 0.25MCG','Calcitriol','Active Vitamin D','1-0-0',30,'after_food'),
('Orthopedic',65,'ALENDRONATE 70MG','Alendronate','Bisphosphonate Antiresorptive','1-0-0',7,'empty_stomach'),
('Orthopedic',66,'ALENDRONATE 70MG + D3 2800IU','Alendronate + Cholecalciferol','Bisphosphonate + Vitamin D','1-0-0',7,'empty_stomach'),
('Orthopedic',67,'RISEDRONATE 35MG','Risedronate','Bisphosphonate Antiresorptive','1-0-0',7,'empty_stomach'),
('Orthopedic',68,'RISEDRONATE 150MG MONTHLY','Risedronate','Bisphosphonate Antiresorptive','1-0-0',30,'empty_stomach'),
('Orthopedic',69,'IBANDRONATE 150MG MONTHLY','Ibandronate','Bisphosphonate Antiresorptive','1-0-0',30,'empty_stomach'),
('Orthopedic',70,'ZOLEDRONIC ACID 5MG INJ','Zoledronic Acid','IV Bisphosphonate Annual','sos',0,'after_food'),
('Orthopedic',71,'CALCITONIN NASAL SPRAY 200IU','Salmon Calcitonin','Antiresorptive/Analgesic','1-0-0',30,'after_food'),
('Orthopedic',72,'STRONTIUM RANELATE 2GM SACHET','Strontium Ranelate','Dual Action Antiresorptive','0-0-1',30,'empty_stomach'),
('Orthopedic',73,'DENOSUMAB 60MG INJ','Denosumab','RANK-L Inhibitor Antiresorptive','sos',0,'after_food'),
('Orthopedic',74,'RALOXIFENE 60MG','Raloxifene','SERM Antiresorptive','1-0-0',30,'after_food'),
('Orthopedic',75,'TERIPARATIDE 20MCG INJ','Teriparatide','PTH Analogue Anabolic','sos',0,'after_food'),
('Orthopedic',76,'MAGNESIUM 250MG','Magnesium Oxide','Mineral Supplement','1-0-0',30,'after_food'),
('Orthopedic',77,'VITAMIN K2-7 100MCG','Menaquinone-7','Vitamin K2 Bone','1-0-0',90,'after_food'),
('Orthopedic',78,'DICLOFENAC GEL 1%','Diclofenac','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',79,'KETOPROFEN GEL 2.5%','Ketoprofen','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',80,'ACECLOFENAC GEL 1%','Aceclofenac','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',81,'IBUPROFEN GEL 5%','Ibuprofen','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',82,'PIROXICAM GEL 0.5%','Piroxicam','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',83,'NIMESULIDE GEL 1%','Nimesulide','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',84,'LORNOXICAM GEL 1%','Lornoxicam','Topical NSAID','1-0-1',14,'after_food'),
('Orthopedic',85,'METHYL SALICYLATE + MENTHOL GEL','Methyl Salicylate + Menthol','Topical Analgesic/Counter-Irritant','1-1-1',14,'after_food'),
('Orthopedic',86,'CAPSAICIN CREAM 0.025%','Capsaicin','Topical Analgesic','1-0-1',30,'after_food'),
('Orthopedic',87,'CAPSAICIN CREAM 0.075%','Capsaicin','Topical Analgesic High Strength','1-0-1',30,'after_food'),
('Orthopedic',88,'LIDOCAINE + PRILOCAINE CREAM 5%','Lidocaine + Prilocaine','Topical Anesthetic','sos',0,'after_food'),
('Orthopedic',89,'COMFREY ROOT GEL 10%','Symphytum Officinale Extract','Topical Herbal Analgesic','1-0-1',14,'after_food'),
('Orthopedic',90,'DICLOFENAC + METHYL SALICYLATE GEL','Diclofenac + Methyl Salicylate','Topical NSAID + Counter-Irritant','1-0-1',14,'after_food'),
('Orthopedic',91,'ALLOPURINOL 100MG','Allopurinol','Xanthine Oxidase Inhibitor Gout','1-0-0',30,'after_food'),
('Orthopedic',92,'ALLOPURINOL 300MG','Allopurinol','Xanthine Oxidase Inhibitor Gout','1-0-0',30,'after_food'),
('Orthopedic',93,'COLCHICINE 0.5MG','Colchicine','Anti-Inflammatory Gout','1-0-1',3,'after_food'),
('Orthopedic',94,'FEBUXOSTAT 40MG','Febuxostat','Xanthine Oxidase Inhibitor Gout','1-0-0',30,'after_food'),
('Orthopedic',95,'FEBUXOSTAT 80MG','Febuxostat','Xanthine Oxidase Inhibitor Gout','1-0-0',30,'after_food'),
('Orthopedic',96,'BENZBROMARONE 100MG','Benzbromarone','Uricosuric Gout','1-0-0',30,'after_food'),
('Orthopedic',97,'PROBENECID 500MG','Probenecid','Uricosuric Gout','1-0-1',30,'after_food'),
('Orthopedic',98,'PREDNISOLONE 10MG','Prednisolone','Corticosteroid','1-0-0',7,'after_food'),
('Orthopedic',99,'PREDNISOLONE 20MG','Prednisolone','Corticosteroid','1-0-0',5,'after_food'),
('Orthopedic',100,'METHYLPREDNISOLONE 4MG','Methylprednisolone','Corticosteroid','1-0-0',7,'after_food'),
('Orthopedic',101,'DEXAMETHASONE 4MG','Dexamethasone','Corticosteroid','1-0-0',5,'after_food'),
('Orthopedic',102,'TRIAMCINOLONE ACETONIDE 40MG INJ','Triamcinolone Acetonide','Intraarticular Corticosteroid','sos',0,'after_food'),
('Orthopedic',103,'METHYLPREDNISOLONE ACETATE 40MG INJ','Methylprednisolone Acetate','Intraarticular Corticosteroid','sos',0,'after_food'),
('Orthopedic',104,'BETAMETHASONE 4MG INJ','Betamethasone','Injectable Corticosteroid','sos',0,'after_food'),
('Orthopedic',105,'HYALURONIC ACID 20MG/2ML INJ','Sodium Hyaluronate','Viscosupplementation Intraarticular','sos',0,'after_food'),
('Orthopedic',106,'ENOXAPARIN 40MG INJ','Enoxaparin','LMWH DVT Prophylaxis','sos',14,'after_food'),
('Orthopedic',107,'ENOXAPARIN 60MG INJ','Enoxaparin','LMWH DVT Treatment','sos',14,'after_food'),
('Orthopedic',108,'RIVAROXABAN 10MG','Rivaroxaban','Factor Xa Inhibitor DVT Prophylaxis','1-0-0',35,'after_food'),
('Orthopedic',109,'FONDAPARINUX 2.5MG INJ','Fondaparinux','Factor Xa Inhibitor DVT Prophylaxis','sos',14,'after_food'),
('Orthopedic',110,'ASPIRIN 75MG','Aspirin','Antiplatelet','1-0-0',90,'after_food'),
('Orthopedic',111,'CEPHALEXIN 500MG','Cephalexin','First-Generation Cephalosporin','1-1-1',7,'before_food'),
('Orthopedic',112,'AMOXICLAV 625MG','Amoxicillin + Clavulanate','Beta-Lactam Antibiotic','1-0-1',7,'after_food'),
('Orthopedic',113,'CIPROFLOXACIN 500MG','Ciprofloxacin','Fluoroquinolone Antibiotic','1-0-1',7,'empty_stomach'),
('Orthopedic',114,'PANTOPRAZOLE 40MG','Pantoprazole','PPI GI Protection with NSAID','1-0-0',14,'before_food'),
('Orthopedic',115,'GLUCOSAMINE SULFATE 750MG','Glucosamine Sulfate','Joint Supplement','1-0-0',90,'after_food'),
('Orthopedic',116,'GLUCOSAMINE 500MG + CHONDROITIN 400MG','Glucosamine + Chondroitin','Joint Supplement Combination','1-0-1',90,'after_food'),
('Orthopedic',117,'GLUCOSAMINE + CHONDROITIN + MSM','Glucosamine + Chondroitin + MSM','Joint Supplement Combination','1-0-1',90,'after_food'),
('Orthopedic',118,'DIACERHEIN 50MG','Diacerhein','IL-1 Inhibitor Cartilage Protector','0-0-1',90,'after_food'),
('Orthopedic',119,'AVOCADO SOYBEAN UNSAPONIFIABLES 300MG','ASU','Cartilage Protector SYSADOA','1-0-0',90,'after_food'),
('Orthopedic',120,'CURCUMIN 500MG','Curcumin (Turmeric Extract)','Anti-Inflammatory Nutraceutical','1-0-1',90,'after_food'),
('Orthopedic',121,'BOSWELLIA SERRATA 400MG','Boswellia Serrata Extract','Anti-Inflammatory Nutraceutical','1-0-1',90,'after_food'),
('Orthopedic',122,'COLLAGEN PEPTIDES 5GM','Hydrolyzed Collagen','Joint Supplement Nutraceutical','1-0-0',90,'after_food'),
('Orthopedic',123,'METHYLSULFONYLMETHANE 500MG','MSM','Anti-Inflammatory Supplement','1-0-1',90,'after_food'),
('Orthopedic',124,'OMEGA-3 FATTY ACIDS 1GM','Omega-3 EPA/DHA','Anti-Inflammatory Supplement','0-0-1',90,'after_food'),
('Orthopedic',125,'VITAMIN C 500MG','Ascorbic Acid','Antioxidant Collagen Synthesis','1-0-0',30,'after_food'),
('Orthopedic',126,'ZINC 20MG','Zinc','Trace Mineral Bone Healing','1-0-0',30,'after_food'),
('Orthopedic',127,'HYDROXYCHLOROQUINE 200MG','Hydroxychloroquine','DMARD Inflammatory Arthritis','1-0-0',90,'after_food'),
('Orthopedic',128,'SULFASALAZINE 500MG','Sulfasalazine','DMARD Inflammatory Arthritis','1-0-1',90,'after_food'),
('Orthopedic',129,'LEFLUNOMIDE 10MG','Leflunomide','DMARD Rheumatoid Arthritis','1-0-0',90,'after_food'),
('Orthopedic',130,'METHOTREXATE 7.5MG','Methotrexate','Folate Antagonist DMARD','1-0-0',90,'after_food'),
('Orthopedic',131,'AZATHIOPRINE 50MG','Azathioprine','Immunosuppressant DMARD','1-0-1',90,'after_food'),
('Orthopedic',132,'PREDNISOLONE 5MG','Prednisolone','Low-Dose Corticosteroid DMARD Bridge','1-0-0',30,'after_food'),
('Orthopedic',133,'NAPROXEN + ESOMEPRAZOLE 500MG+20MG','Naproxen + Esomeprazole','NSAID + PPI Fixed Combination','1-0-1',14,'after_food'),
('Orthopedic',134,'DICLOFENAC + MISOPROSTOL','Diclofenac + Misoprostol','NSAID + GI Protectant Fixed Combination','1-0-1',14,'after_food'),
('Orthopedic',135,'PLATELET RICH PLASMA KIT','PRP Preparation','Biologic Procedure','sos',0,'after_food'),
('Orthopedic',136,'CEFTRIAXONE 1GM INJ','Ceftriaxone','Third-Generation Cephalosporin IV','sos',7,'after_food'),
('Orthopedic',137,'AMPICILLIN + SULBACTAM 1.5GM INJ','Ampicillin + Sulbactam','Beta-Lactam + Inhibitor IV','sos',7,'after_food'),
('Orthopedic',138,'METRONIDAZOLE 500MG INJ','Metronidazole','Antiprotozoal/Antianaerobe IV','sos',5,'after_food'),
('Orthopedic',139,'ONDANSETRON 4MG','Ondansetron','Antiemetic','1-0-1',3,'before_food'),
('Orthopedic',140,'PANTOPRAZOLE + DOMPERIDONE','Pantoprazole + Domperidone','PPI + Prokinetic','1-0-1',14,'before_food'),
('Orthopedic',141,'DICLOFENAC SR 75MG + THIOCOLCHICOSIDE 8MG','Diclofenac SR + Thiocolchicoside','NSAID SR + Muscle Relaxant Combination','1-0-0',7,'after_food'),
('Orthopedic',142,'TRAMADOL 50MG INJ','Tramadol','Injectable Opioid Analgesic','sos',3,'after_food'),
('Orthopedic',143,'APREMILAST 30MG','Apremilast','PDE4 Inhibitor Psoriatic Arthritis','1-0-1',30,'after_food'),
('Orthopedic',144,'FOLIC ACID 5MG','Folic Acid','B Vitamin (with Methotrexate)','1-0-0',90,'after_food'),
('Orthopedic',145,'CALCIUM GLUCONATE 10% INJ','Calcium Gluconate','IV Calcium Emergency','sos',0,'after_food'),
('Orthopedic',146,'VITAMIN B COMPLEX','Vitamin B Complex','Neuroprotective Supplement','1-0-0',30,'after_food'),
('Orthopedic',147,'MAGNESIUM SULFATE 50% INJ','Magnesium Sulfate','IV Magnesium','sos',0,'after_food'),
('Orthopedic',148,'TRAMADOL 100MG INJ','Tramadol','Injectable Opioid Analgesic Strong','sos',3,'after_food'),
('Orthopedic',149,'ROMOSOZUMAB 210MG INJ','Romosozumab','Sclerostin Inhibitor Anabolic Osteoporosis','sos',0,'after_food'),
('Orthopedic',150,'STRONTIUM CITRATE 680MG','Strontium Citrate','Dual Action Bone Agent','1-0-0',90,'after_food');

-- ═══════════════════════════════════════════════════════════
-- PART C: ENT (150 rows)
-- ═══════════════════════════════════════════════════════════
INSERT INTO specialty_starter_packs(specialty, rank, drug_name, generic_name, category, default_dosage, default_duration, default_timing) VALUES
('ENT',1,'AMOXICILLIN 250MG','Amoxicillin','Penicillin Antibiotic','1-1-1',7,'before_food'),
('ENT',2,'AMOXICILLIN 500MG','Amoxicillin','Penicillin Antibiotic','1-0-1',7,'before_food'),
('ENT',3,'AMOXICLAV 375MG','Amoxicillin + Clavulanate','Beta-Lactam Antibiotic','1-1-1',7,'after_food'),
('ENT',4,'AMOXICLAV 625MG','Amoxicillin + Clavulanate','Beta-Lactam Antibiotic','1-0-1',7,'after_food'),
('ENT',5,'AMOXICLAV 1GM','Amoxicillin + Clavulanate','Beta-Lactam Antibiotic High Dose','1-0-1',7,'after_food'),
('ENT',6,'AZITHROMYCIN 250MG','Azithromycin','Macrolide Antibiotic','1-0-0',5,'empty_stomach'),
('ENT',7,'AZITHROMYCIN 500MG','Azithromycin','Macrolide Antibiotic','1-0-0',3,'empty_stomach'),
('ENT',8,'CLARITHROMYCIN 250MG','Clarithromycin','Macrolide Antibiotic','1-0-1',7,'after_food'),
('ENT',9,'CLARITHROMYCIN 500MG','Clarithromycin','Macrolide Antibiotic','1-0-1',7,'after_food'),
('ENT',10,'CEFUROXIME 250MG','Cefuroxime','Second-Generation Cephalosporin','1-0-1',7,'after_food'),
('ENT',11,'CEFUROXIME 500MG','Cefuroxime','Second-Generation Cephalosporin','1-0-1',7,'after_food'),
('ENT',12,'CEFPODOXIME 100MG','Cefpodoxime','Third-Generation Cephalosporin','1-0-1',5,'after_food'),
('ENT',13,'CEFPODOXIME 200MG','Cefpodoxime','Third-Generation Cephalosporin','1-0-1',5,'after_food'),
('ENT',14,'LEVOFLOXACIN 250MG','Levofloxacin','Fluoroquinolone Antibiotic','1-0-0',7,'after_food'),
('ENT',15,'LEVOFLOXACIN 500MG','Levofloxacin','Fluoroquinolone Antibiotic','1-0-0',7,'after_food'),
('ENT',16,'DOXYCYCLINE 100MG','Doxycycline','Tetracycline Antibiotic','1-0-1',7,'after_food'),
('ENT',17,'CLINDAMYCIN 150MG','Clindamycin','Lincosamide Antibiotic','1-1-1',7,'after_food'),
('ENT',18,'CLINDAMYCIN 300MG','Clindamycin','Lincosamide Antibiotic','1-0-1',7,'after_food'),
('ENT',19,'ORNIDAZOLE 500MG','Ornidazole','Nitroimidazole Antiprotozoal','1-0-1',5,'after_food'),
('ENT',20,'CEFTRIAXONE 1GM INJ','Ceftriaxone','Third-Generation Cephalosporin IV','sos',7,'after_food'),
('ENT',21,'CETIRIZINE 10MG','Cetirizine','Antihistamine','0-0-1',7,'after_food'),
('ENT',22,'LEVOCETIRIZINE 5MG','Levocetirizine','Antihistamine','0-0-1',7,'after_food'),
('ENT',23,'FEXOFENADINE 120MG','Fexofenadine','Non-Sedating Antihistamine','1-0-0',7,'after_food'),
('ENT',24,'FEXOFENADINE 180MG','Fexofenadine','Non-Sedating Antihistamine','1-0-0',14,'after_food'),
('ENT',25,'LORATADINE 10MG','Loratadine','Non-Sedating Antihistamine','1-0-0',7,'after_food'),
('ENT',26,'DESLORATADINE 5MG','Desloratadine','Non-Sedating Antihistamine','1-0-0',14,'after_food'),
('ENT',27,'BILASTINE 20MG','Bilastine','Non-Sedating Antihistamine','1-0-0',14,'before_food'),
('ENT',28,'RUPATADINE 10MG','Rupatadine','Non-Sedating Antihistamine','0-0-1',14,'after_food'),
('ENT',29,'CHLORPHENIRAMINE 4MG','Chlorpheniramine Maleate','Sedating Antihistamine','1-1-1',5,'after_food'),
('ENT',30,'MONTELUKAST 10MG','Montelukast','Leukotriene Antagonist','0-0-1',14,'before_food'),
('ENT',31,'MONTELUKAST 10MG + LEVOCETIRIZINE 5MG','Montelukast + Levocetirizine','Leukotriene Antagonist + Antihistamine','0-0-1',14,'before_food'),
('ENT',32,'FLUTICASONE NASAL SPRAY 50MCG','Fluticasone Propionate','Nasal Corticosteroid','1-0-1',30,'after_food'),
('ENT',33,'MOMETASONE NASAL SPRAY 50MCG','Mometasone Furoate','Nasal Corticosteroid','1-0-0',30,'after_food'),
('ENT',34,'BUDESONIDE NASAL SPRAY 64MCG','Budesonide','Nasal Corticosteroid','1-0-1',30,'after_food'),
('ENT',35,'BECLOMETHASONE NASAL SPRAY 50MCG','Beclomethasone','Nasal Corticosteroid','1-1-0',30,'after_food'),
('ENT',36,'TRIAMCINOLONE NASAL SPRAY 55MCG','Triamcinolone','Nasal Corticosteroid','1-0-0',30,'after_food'),
('ENT',37,'AZELASTINE NASAL SPRAY 0.1%','Azelastine','Nasal Antihistamine','1-0-1',30,'after_food'),
('ENT',38,'DYMISTA NASAL SPRAY (AZELASTINE + FLUTICASONE)','Azelastine + Fluticasone','Nasal Antihistamine + Steroid Combination','1-0-1',30,'after_food'),
('ENT',39,'OLOPATADINE NASAL SPRAY 0.6%','Olopatadine','Nasal Antihistamine','1-0-1',30,'after_food'),
('ENT',40,'SODIUM CROMOGLICATE NASAL SPRAY 2%','Sodium Cromoglicate','Nasal Mast Cell Stabilizer','1-1-1',30,'after_food'),
('ENT',41,'XYLOMETAZOLINE 0.1% NASAL DROPS','Xylometazoline','Nasal Decongestant','1-1-1',3,'after_food'),
('ENT',42,'XYLOMETAZOLINE 0.05% NASAL DROPS','Xylometazoline','Nasal Decongestant Paediatric','1-1-1',3,'after_food'),
('ENT',43,'OXYMETAZOLINE 0.05% NASAL SPRAY','Oxymetazoline','Nasal Decongestant','1-0-1',3,'after_food'),
('ENT',44,'IPRATROPIUM BROMIDE 0.03% NASAL SPRAY','Ipratropium Bromide','Anticholinergic Nasal Spray','1-0-1',14,'after_food'),
('ENT',45,'SALINE NASAL DROPS 0.9%','Sodium Chloride','Nasal Saline Irrigation','1-1-1',0,'after_food'),
('ENT',46,'HYPERTONIC SALINE NASAL SPRAY 2.3%','Hypertonic Saline','Nasal Decongestion/Mucociliary','1-1-1',0,'after_food'),
('ENT',47,'BETAHISTINE 8MG','Betahistine','Anti-Vertigo H1 Agonist','1-1-1',30,'after_food'),
('ENT',48,'BETAHISTINE 16MG','Betahistine','Anti-Vertigo H1 Agonist','1-0-1',30,'after_food'),
('ENT',49,'BETAHISTINE 24MG','Betahistine','Anti-Vertigo H1 Agonist','1-0-1',30,'after_food'),
('ENT',50,'CINNARIZINE 25MG','Cinnarizine','Anti-Vertigo Antihistamine','1-1-1',14,'after_food'),
('ENT',51,'CINNARIZINE 75MG SR','Cinnarizine','Anti-Vertigo SR','1-0-1',14,'after_food'),
('ENT',52,'PROMETHAZINE 25MG','Promethazine','Antihistamine/Antiemetic/Sedative','0-0-1',7,'after_food'),
('ENT',53,'DIMENHYDRINATE 50MG','Dimenhydrinate','Anti-Vertigo Antihistamine','1-1-1',5,'after_food'),
('ENT',54,'PROCHLORPERAZINE 5MG','Prochlorperazine','Dopamine Antagonist Anti-Vertigo','1-0-1',7,'after_food'),
('ENT',55,'AMBROXOL 30MG','Ambroxol','Mucolytic Expectorant','1-1-1',7,'after_food'),
('ENT',56,'BROMHEXINE 8MG','Bromhexine','Mucolytic','1-1-1',7,'after_food'),
('ENT',57,'CARBOCISTEINE 375MG','Carbocisteine','Mucolytic','1-1-1',7,'after_food'),
('ENT',58,'N-ACETYLCYSTEINE 600MG','N-Acetylcysteine','Mucolytic/Antioxidant','1-0-0',7,'after_food'),
('ENT',59,'ERDOSTEINE 300MG','Erdosteine','Mucolytic','1-0-1',7,'after_food'),
('ENT',60,'GUAIFENESIN 200MG','Guaifenesin','Expectorant','1-1-1',7,'after_food'),
('ENT',61,'PREDNISOLONE 10MG','Prednisolone','Oral Corticosteroid','1-0-0',7,'after_food'),
('ENT',62,'PREDNISOLONE 20MG','Prednisolone','Oral Corticosteroid','1-0-0',5,'after_food'),
('ENT',63,'PREDNISOLONE 40MG','Prednisolone','Oral Corticosteroid High Dose','1-0-0',5,'after_food'),
('ENT',64,'METHYLPREDNISOLONE 4MG','Methylprednisolone','Oral Corticosteroid','1-0-0',7,'after_food'),
('ENT',65,'METHYLPREDNISOLONE 8MG','Methylprednisolone','Oral Corticosteroid','1-0-0',5,'after_food'),
('ENT',66,'DEXAMETHASONE 4MG','Dexamethasone','Oral Corticosteroid','1-0-0',5,'after_food'),
('ENT',67,'DEFLAZACORT 6MG','Deflazacort','Oral Corticosteroid','1-0-0',7,'after_food'),
('ENT',68,'HYDROCORTISONE 100MG INJ','Hydrocortisone Sodium Succinate','Injectable Corticosteroid Emergency','sos',0,'after_food'),
('ENT',69,'CIPROFLOXACIN + DEXAMETHASONE EAR DROPS','Ciprofloxacin + Dexamethasone','Topical Otic Antibiotic + Steroid','1-0-1',7,'after_food'),
('ENT',70,'CIPROFLOXACIN 0.3% EAR DROPS','Ciprofloxacin','Topical Otic Antibiotic','1-0-1',7,'after_food'),
('ENT',71,'GENTAMICIN 0.3% EAR DROPS','Gentamicin','Topical Otic Antibiotic','1-0-1',7,'after_food'),
('ENT',72,'CHLORAMPHENICOL EAR DROPS 5%','Chloramphenicol','Topical Otic Antibiotic','1-0-1',7,'after_food'),
('ENT',73,'NEOMYCIN + POLYMYXIN B EAR DROPS','Neomycin + Polymyxin B','Topical Otic Antibiotic Combination','1-0-1',7,'after_food'),
('ENT',74,'CLOTRIMAZOLE 1% EAR DROPS','Clotrimazole','Topical Otic Antifungal','1-0-1',14,'after_food'),
('ENT',75,'HYDROGEN PEROXIDE 3% EAR DROPS','Hydrogen Peroxide','Ear Wax Softener/Ceruminolytic','1-0-1',3,'after_food'),
('ENT',76,'ACETIC ACID 2% EAR DROPS','Acetic Acid','Topical Otic Antiseptic','1-0-1',7,'after_food'),
('ENT',77,'BORIC ACID SPIRIT EAR DROPS','Boric Acid + Spirit','Topical Otic Drying Agent','1-0-1',7,'after_food'),
('ENT',78,'FLUMETHASONE + CLOTRIMAZOLE EAR DROPS','Flumethasone + Clotrimazole','Topical Otic Steroid + Antifungal','1-0-1',14,'after_food'),
('ENT',79,'CHOLINE SALICYLATE + GLYCERIN EAR DROPS','Choline Salicylate','Topical Otic Analgesic/Ceruminolytic','1-0-1',5,'after_food'),
('ENT',80,'BENZYDAMINE 0.15% MOUTHWASH','Benzydamine Hydrochloride','Topical Oral Anti-Inflammatory Mouthwash','1-1-1',7,'after_food'),
('ENT',81,'CHLORHEXIDINE 0.2% MOUTHWASH','Chlorhexidine Gluconate','Topical Oral Antiseptic Mouthwash','1-0-1',7,'after_food'),
('ENT',82,'POVIDONE IODINE 1% GARGLE','Povidone Iodine','Topical Oral Antiseptic Gargle','1-1-1',5,'after_food'),
('ENT',83,'BENZOCAINE + MENTHOL LOZENGES','Benzocaine + Menthol','Topical Oral Anesthetic Lozenge','1-1-1',5,'after_food'),
('ENT',84,'AMYLMETACRESOL + DICHLOROBENZYL ALCOHOL LOZENGES','Amylmetacresol + DCBA','Topical Oral Antiseptic Lozenge','1-1-1',5,'after_food'),
('ENT',85,'LIGNOCAINE OROPHARYNGEAL SPRAY 10%','Lignocaine','Topical Oral Local Anesthetic Spray','sos',0,'after_food'),
('ENT',86,'PHENYLEPHRINE 0.5% NASAL DROPS','Phenylephrine','Nasal Decongestant','1-1-1',3,'after_food'),
('ENT',87,'NAPHAZOLINE 0.05% NASAL DROPS','Naphazoline','Nasal Decongestant','1-1-1',3,'after_food'),
('ENT',88,'ACYCLOVIR 400MG','Acyclovir','Antiviral Herpes','1-1-1-1-1',7,'after_food'),
('ENT',89,'ACYCLOVIR 800MG','Acyclovir','Antiviral Herpes Zoster','1-1-1-1-1',7,'after_food'),
('ENT',90,'VALACYCLOVIR 500MG','Valacyclovir','Antiviral Herpes','1-0-1',7,'after_food'),
('ENT',91,'VALACYCLOVIR 1000MG','Valacyclovir','Antiviral Herpes Zoster','1-1-1',7,'after_food'),
('ENT',92,'FAMCICLOVIR 250MG','Famciclovir','Antiviral Herpes Zoster','1-1-1',7,'after_food'),
('ENT',93,'ITRACONAZOLE 100MG','Itraconazole','Systemic Antifungal','1-0-1',7,'after_food'),
('ENT',94,'FLUCONAZOLE 150MG','Fluconazole','Systemic Antifungal','1-0-0',1,'after_food'),
('ENT',95,'TERBINAFINE 250MG','Terbinafine','Systemic Antifungal','1-0-0',14,'after_food'),
('ENT',96,'PARACETAMOL 500MG','Paracetamol','Analgesic/Antipyretic','1-1-1',5,'after_food'),
('ENT',97,'IBUPROFEN 400MG','Ibuprofen','NSAID/Analgesic','1-1-1',5,'after_food'),
('ENT',98,'NAPROXEN 250MG','Naproxen','NSAID/Analgesic','1-0-1',5,'after_food'),
('ENT',99,'DICLOFENAC 50MG','Diclofenac','NSAID/Analgesic','1-0-1',5,'after_food'),
('ENT',100,'PANTOPRAZOLE 40MG','Pantoprazole','PPI GI Protection','1-0-0',14,'before_food'),
('ENT',101,'ONDANSETRON 4MG','Ondansetron','Antiemetic','1-0-1',3,'before_food'),
('ENT',102,'PENTOXIFYLLINE 400MG','Pentoxifylline','Hemorrheological Agent Sudden SNHL','1-1-1',30,'after_food'),
('ENT',103,'GINKGO BILOBA 40MG','Ginkgo Biloba Extract','Herbal Microcirculation Tinnitus/SNHL','1-0-1',90,'after_food'),
('ENT',104,'METHYLCOBALAMIN 1500MCG','Methylcobalamin','Vitamin B12 Neuroprotective','1-0-0',30,'after_food'),
('ENT',105,'PREGABALIN 75MG','Pregabalin','Anticonvulsant/Tinnitus','0-0-1',30,'after_food'),
('ENT',106,'AMITRIPTYLINE 10MG','Amitriptyline','TCA/Tinnitus/Neuropathic','0-0-1',30,'after_food'),
('ENT',107,'NORTRIPTYLINE 10MG','Nortriptyline','TCA/Tinnitus','0-0-1',30,'after_food'),
('ENT',108,'CARBAMAZEPINE 200MG','Carbamazepine','Anticonvulsant/Trigeminal Neuralgia','1-0-1',30,'after_food'),
('ENT',109,'HYDROXYZINE 25MG','Hydroxyzine','Antihistamine/Anxiolytic','0-0-1',7,'after_food'),
('ENT',110,'VITAMIN C 500MG','Ascorbic Acid','Antioxidant Immunity','1-0-0',30,'after_food'),
('ENT',111,'VITAMIN D3 60000IU','Cholecalciferol','Vitamin D Weekly','1-0-0',28,'after_food'),
('ENT',112,'ZINC 20MG','Zinc','Trace Mineral Immunity/Taste','1-0-0',30,'after_food'),
('ENT',113,'BUDESONIDE RESPULES 0.5MG/2ML','Budesonide','Nebulized Corticosteroid','1-0-1',7,'after_food'),
('ENT',114,'SALBUTAMOL 2.5MG NEBULIZER SOLUTION','Salbutamol','Nebulized Bronchodilator','1-1-1',5,'after_food'),
('ENT',115,'IPRATROPIUM 0.25MG NEBULIZER SOLUTION','Ipratropium Bromide','Nebulized Anticholinergic','1-0-1',5,'after_food'),
('ENT',116,'BUDESONIDE + FORMOTEROL INHALER','Budesonide + Formoterol','Inhaled Steroid + LABA','1-0-1',30,'after_food'),
('ENT',117,'FLUTICASONE + SALMETEROL INHALER','Fluticasone + Salmeterol','Inhaled Steroid + LABA','1-0-1',30,'after_food'),
('ENT',118,'MOMETASONE FUROATE + FORMOTEROL INHALER','Mometasone + Formoterol','Inhaled Steroid + LABA','1-0-1',30,'after_food'),
('ENT',119,'FLUTICASONE FUROATE NASAL SPRAY 27.5MCG','Fluticasone Furoate','Nasal Corticosteroid Once Daily','1-0-0',30,'after_food'),
('ENT',120,'CICLESONIDE NASAL SPRAY 50MCG','Ciclesonide','Nasal Corticosteroid','1-0-0',30,'after_food'),
('ENT',121,'LINEZOLID 600MG','Linezolid','Oxazolidinone Antibiotic','1-0-1',7,'after_food'),
('ENT',122,'MOXIFLOXACIN 400MG','Moxifloxacin','Fluoroquinolone Antibiotic','1-0-0',5,'after_food'),
('ENT',123,'METRONIDAZOLE 400MG','Metronidazole','Antiprotozoal Antianaerobe','1-1-1',5,'after_food'),
('ENT',124,'AMPICILLIN + SULBACTAM 1.5GM INJ','Ampicillin + Sulbactam','Beta-Lactam + Inhibitor IV','sos',7,'after_food'),
('ENT',125,'GENTAMICIN 80MG INJ','Gentamicin','Aminoglycoside IV','sos',7,'after_food'),
('ENT',126,'METRONIDAZOLE 500MG INJ','Metronidazole','Antiprotozoal IV','sos',5,'after_food'),
('ENT',127,'DEXAMETHASONE 8MG INJ','Dexamethasone','IV Corticosteroid ENT Emergency','sos',0,'after_food'),
('ENT',128,'TOBRAMYCIN 0.3% EYE/EAR DROPS','Tobramycin','Topical Aminoglycoside Ophthalmic/Otic','1-0-1',7,'after_food'),
('ENT',129,'ADRENALINE 1MG/ML INJ','Epinephrine','Emergency Vasopressor Anaphylaxis','sos',0,'after_food'),
('ENT',130,'DEXTROMETHORPHAN 15MG','Dextromethorphan','Cough Suppressant','1-1-1',5,'after_food'),
('ENT',131,'CODEINE LINCTUS 15MG/5ML','Codeine','Narcotic Cough Suppressant Schedule H1','1-1-1',5,'after_food'),
('ENT',132,'SERRATIOPEPTIDASE 10MG','Serratiopeptidase','Proteolytic Enzyme Anti-Inflammatory','1-0-1',14,'empty_stomach'),
('ENT',133,'DOXYCYCLINE 100MG + SERRATIOPEPTIDASE','Doxycycline + Serratiopeptidase','Antibiotic + Enzyme Combination','1-0-1',7,'after_food'),
('ENT',134,'FLUTICASONE PROPIONATE + AZELASTINE 50+137MCG','Fluticasone + Azelastine','Nasal Steroid + Antihistamine Fixed Dose','1-0-1',30,'after_food'),
('ENT',135,'OLOPATADINE 0.1% EYE DROPS','Olopatadine','Ophthalmic Antihistamine Allergic Conjunctivitis','1-0-1',14,'after_food'),
('ENT',136,'TOBRAMYCIN 0.3% + DEXAMETHASONE 0.1% EYE DROPS','Tobramycin + Dexamethasone','Ophthalmic Antibiotic + Steroid','1-1-1',7,'after_food'),
('ENT',137,'HYDROXYZINE 10MG','Hydroxyzine','Antihistamine/Anxiolytic Mild','0-0-1',7,'after_food'),
('ENT',138,'DIAZEPAM 5MG','Diazepam','Benzodiazepine Procedure Anxiolysis','sos',0,'before_food'),
('ENT',139,'MIDAZOLAM 2.5MG','Midazolam','Benzodiazepine IV Sedation Schedule H1','sos',0,'before_food'),
('ENT',140,'LIDOCAINE 2% INJECTION','Lidocaine','Local Anesthetic Injectable','sos',0,'after_food'),
('ENT',141,'LIDOCAINE + ADRENALINE INJECTION','Lidocaine + Epinephrine','Local Anesthetic with Vasoconstrictor','sos',0,'after_food'),
('ENT',142,'BUPIVACAINE 0.5% INJECTION','Bupivacaine','Long-Acting Local Anesthetic','sos',0,'after_food'),
('ENT',143,'FOLIC ACID 5MG','Folic Acid','B Vitamin Mucosal Health','1-0-0',30,'after_food'),
('ENT',144,'VITAMIN B12 1500MCG','Methylcobalamin','Vitamin B12 Neuroprotective','1-0-0',30,'after_food'),
('ENT',145,'MULTIVITAMIN + MINERALS','Multivitamin Complex','Nutritional Supplement Immunity','1-0-0',30,'after_food'),
('ENT',146,'SELENIUM 100MCG','Selenium','Trace Mineral Antioxidant Immunity','1-0-0',30,'after_food'),
('ENT',147,'ERYTHROMYCIN 250MG','Erythromycin','Macrolide Antibiotic','1-1-1',7,'before_food'),
('ENT',148,'CLOXACILLIN 500MG','Cloxacillin','Penicillinase-Resistant Penicillin','1-1-1',7,'empty_stomach'),
('ENT',149,'NASAL DOUCHE SALINE SACHET','NaCl + NaHCO3','Nasal Irrigation Solution','1-0-1',0,'after_food'),
('ENT',150,'SEAWATER ISOTONIC NASAL SPRAY','Isotonic Seawater','Physiological Nasal Cleansing','1-1-1',0,'after_food');

-- ═══════════════════════════════════════════════════════════
-- PART D: OPHTHALMOLOGIST (150 rows)
-- ═══════════════════════════════════════════════════════════
INSERT INTO specialty_starter_packs(specialty, rank, drug_name, generic_name, category, default_dosage, default_duration, default_timing) VALUES
('Ophthalmologist',1,'TOBRAMYCIN 0.3% EYE DROPS','Tobramycin','Topical Ophthalmic Aminoglycoside','1-1-1',7,'after_food'),
('Ophthalmologist',2,'GENTAMICIN 0.3% EYE DROPS','Gentamicin','Topical Ophthalmic Aminoglycoside','1-1-1',7,'after_food'),
('Ophthalmologist',3,'CIPROFLOXACIN 0.3% EYE DROPS','Ciprofloxacin','Topical Ophthalmic Fluoroquinolone','1-1-1',7,'after_food'),
('Ophthalmologist',4,'OFLOXACIN 0.3% EYE DROPS','Ofloxacin','Topical Ophthalmic Fluoroquinolone','1-1-1',7,'after_food'),
('Ophthalmologist',5,'MOXIFLOXACIN 0.5% EYE DROPS','Moxifloxacin','Topical Ophthalmic Fluoroquinolone','1-1-1',7,'after_food'),
('Ophthalmologist',6,'GATIFLOXACIN 0.3% EYE DROPS','Gatifloxacin','Topical Ophthalmic Fluoroquinolone','1-1-1',7,'after_food'),
('Ophthalmologist',7,'LEVOFLOXACIN 0.5% EYE DROPS','Levofloxacin','Topical Ophthalmic Fluoroquinolone','1-1-1',7,'after_food'),
('Ophthalmologist',8,'CHLORAMPHENICOL 0.5% EYE DROPS','Chloramphenicol','Topical Ophthalmic Antibiotic','1-1-1',7,'after_food'),
('Ophthalmologist',9,'FUSIDIC ACID 1% EYE GEL','Fusidic Acid','Topical Ophthalmic Antibiotic Gel','1-0-1',7,'after_food'),
('Ophthalmologist',10,'AZITHROMYCIN 1% EYE DROPS','Azithromycin','Topical Ophthalmic Macrolide','1-0-1',3,'after_food'),
('Ophthalmologist',11,'TOBRAMYCIN 0.3% EYE OINTMENT','Tobramycin','Topical Ophthalmic Ointment','0-0-1',7,'after_food'),
('Ophthalmologist',12,'CIPROFLOXACIN 0.3% EYE OINTMENT','Ciprofloxacin','Topical Ophthalmic Fluoroquinolone Ointment','0-0-1',7,'after_food'),
('Ophthalmologist',13,'CHLORAMPHENICOL 1% EYE OINTMENT','Chloramphenicol','Topical Ophthalmic Antibiotic Ointment','0-0-1',7,'after_food'),
('Ophthalmologist',14,'ERYTHROMYCIN 0.5% EYE OINTMENT','Erythromycin','Topical Ophthalmic Macrolide Ointment','0-0-1',7,'after_food'),
('Ophthalmologist',15,'NEOMYCIN + POLYMYXIN B + GRAMICIDIN EYE DROPS','Neomycin + Polymyxin B + Gramicidin','Topical Ophthalmic Antibiotic Triple','1-1-1',7,'after_food'),
('Ophthalmologist',16,'TOBRAMYCIN + DEXAMETHASONE EYE DROPS','Tobramycin + Dexamethasone','Topical Ophthalmic Antibiotic + Steroid','1-1-1',7,'after_food'),
('Ophthalmologist',17,'MOXIFLOXACIN + DEXAMETHASONE EYE DROPS','Moxifloxacin + Dexamethasone','Topical Ophthalmic Fluoroquinolone + Steroid','1-1-1',7,'after_food'),
('Ophthalmologist',18,'NATAMYCIN 5% EYE DROPS','Natamycin','Topical Ophthalmic Antifungal','1-1-1',21,'after_food'),
('Ophthalmologist',19,'VORICONAZOLE 1% EYE DROPS','Voriconazole','Topical Ophthalmic Antifungal','1-1-1',14,'after_food'),
('Ophthalmologist',20,'ACYCLOVIR 3% EYE OINTMENT','Acyclovir','Topical Ophthalmic Antiviral','1-1-1',7,'after_food'),
('Ophthalmologist',21,'GANCICLOVIR 0.15% EYE GEL','Ganciclovir','Topical Ophthalmic Antiviral Gel','1-1-1',7,'after_food'),
('Ophthalmologist',22,'PREDNISOLONE ACETATE 1% EYE DROPS','Prednisolone Acetate','Topical Ophthalmic Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',23,'DEXAMETHASONE 0.1% EYE DROPS','Dexamethasone','Topical Ophthalmic Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',24,'FLUOROMETHOLONE 0.1% EYE DROPS','Fluorometholone','Topical Ophthalmic Mild Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',25,'FLUOROMETHOLONE 0.25% EYE DROPS','Fluorometholone','Topical Ophthalmic Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',26,'LOTEPREDNOL 0.5% EYE DROPS','Loteprednol Etabonate','Topical Ophthalmic Soft Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',27,'LOTEPREDNOL 0.2% EYE DROPS','Loteprednol Etabonate','Topical Ophthalmic Soft Corticosteroid Low Dose','1-1-1',14,'after_food'),
('Ophthalmologist',28,'DIFLUPREDNATE 0.05% EYE DROPS','Difluprednate','Topical Ophthalmic Potent Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',29,'RIMEXOLONE 1% EYE DROPS','Rimexolone','Topical Ophthalmic Corticosteroid','1-1-1',14,'after_food'),
('Ophthalmologist',30,'DEXAMETHASONE 0.1% EYE OINTMENT','Dexamethasone','Topical Ophthalmic Corticosteroid Ointment','0-0-1',14,'after_food'),
('Ophthalmologist',31,'KETOROLAC 0.5% EYE DROPS','Ketorolac Tromethamine','Topical Ophthalmic NSAID','1-1-1',7,'after_food'),
('Ophthalmologist',32,'DICLOFENAC 0.1% EYE DROPS','Diclofenac','Topical Ophthalmic NSAID','1-1-1',7,'after_food'),
('Ophthalmologist',33,'BROMFENAC 0.09% EYE DROPS','Bromfenac','Topical Ophthalmic NSAID','1-0-1',7,'after_food'),
('Ophthalmologist',34,'NEPAFENAC 0.1% EYE DROPS','Nepafenac','Topical Ophthalmic NSAID','1-1-1',7,'after_food'),
('Ophthalmologist',35,'FLURBIPROFEN 0.03% EYE DROPS','Flurbiprofen','Topical Ophthalmic NSAID','1-1-1',7,'after_food'),
('Ophthalmologist',36,'OLOPATADINE 0.1% EYE DROPS','Olopatadine','Topical Ophthalmic Antihistamine','1-0-1',14,'after_food'),
('Ophthalmologist',37,'OLOPATADINE 0.2% EYE DROPS','Olopatadine','Topical Ophthalmic Antihistamine High Dose','1-0-0',14,'after_food'),
('Ophthalmologist',38,'KETOTIFEN 0.025% EYE DROPS','Ketotifen','Topical Ophthalmic Antihistamine','1-0-1',14,'after_food'),
('Ophthalmologist',39,'AZELASTINE 0.05% EYE DROPS','Azelastine','Topical Ophthalmic Antihistamine','1-0-1',14,'after_food'),
('Ophthalmologist',40,'EPINASTINE 0.05% EYE DROPS','Epinastine','Topical Ophthalmic Antihistamine','1-0-1',14,'after_food'),
('Ophthalmologist',41,'BEPOTASTINE 1.5% EYE DROPS','Bepotastine','Topical Ophthalmic Antihistamine','1-0-1',14,'after_food'),
('Ophthalmologist',42,'SODIUM CROMOGLICATE 2% EYE DROPS','Sodium Cromoglicate','Topical Ophthalmic Mast Cell Stabilizer','1-1-1',14,'after_food'),
('Ophthalmologist',43,'LODOXAMIDE 0.1% EYE DROPS','Lodoxamide','Topical Ophthalmic Mast Cell Stabilizer','1-1-1',14,'after_food'),
('Ophthalmologist',44,'LEVOCABASTINE 0.05% EYE DROPS','Levocabastine','Topical Ophthalmic H1 Antihistamine','1-0-1',14,'after_food'),
('Ophthalmologist',45,'TIMOLOL 0.25% EYE DROPS','Timolol Maleate','Topical Beta Blocker Glaucoma','1-0-1',0,'after_food'),
('Ophthalmologist',46,'TIMOLOL 0.5% EYE DROPS','Timolol Maleate','Topical Beta Blocker Glaucoma','1-0-1',0,'after_food'),
('Ophthalmologist',47,'BETAXOLOL 0.25% EYE DROPS','Betaxolol','Topical Selective Beta Blocker Glaucoma','1-0-1',0,'after_food'),
('Ophthalmologist',48,'LEVOBUNOLOL 0.5% EYE DROPS','Levobunolol','Topical Beta Blocker Glaucoma','1-0-1',0,'after_food'),
('Ophthalmologist',49,'BRIMONIDINE 0.1% EYE DROPS','Brimonidine Tartrate','Topical Alpha Agonist Glaucoma','1-1-1',0,'after_food'),
('Ophthalmologist',50,'BRIMONIDINE 0.15% EYE DROPS','Brimonidine Tartrate','Topical Alpha Agonist Glaucoma','1-1-1',0,'after_food'),
('Ophthalmologist',51,'APRACLONIDINE 0.5% EYE DROPS','Apraclonidine','Topical Alpha Agonist IOP Reduction','1-1-1',0,'after_food'),
('Ophthalmologist',52,'DORZOLAMIDE 2% EYE DROPS','Dorzolamide','Topical Carbonic Anhydrase Inhibitor Glaucoma','1-1-1',0,'after_food'),
('Ophthalmologist',53,'BRINZOLAMIDE 1% EYE DROPS','Brinzolamide','Topical Carbonic Anhydrase Inhibitor Glaucoma','1-1-1',0,'after_food'),
('Ophthalmologist',54,'DORZOLAMIDE 2% + TIMOLOL 0.5% EYE DROPS','Dorzolamide + Timolol','Topical CAI + Beta Blocker Fixed Combination Glaucoma','1-0-1',0,'after_food'),
('Ophthalmologist',55,'BRINZOLAMIDE 1% + TIMOLOL 0.5% EYE DROPS','Brinzolamide + Timolol','Topical CAI + Beta Blocker Fixed Combination Glaucoma','1-0-1',0,'after_food'),
('Ophthalmologist',56,'BRIMONIDINE 0.2% + TIMOLOL 0.5% EYE DROPS','Brimonidine + Timolol','Topical Alpha Agonist + Beta Blocker Fixed Combination','1-0-1',0,'after_food'),
('Ophthalmologist',57,'LATANOPROST 0.005% EYE DROPS','Latanoprost','Prostaglandin Analogue Glaucoma','0-0-1',0,'after_food'),
('Ophthalmologist',58,'BIMATOPROST 0.03% EYE DROPS','Bimatoprost','Prostamide Glaucoma','0-0-1',0,'after_food'),
('Ophthalmologist',59,'TRAVOPROST 0.004% EYE DROPS','Travoprost','Prostaglandin Analogue Glaucoma','0-0-1',0,'after_food'),
('Ophthalmologist',60,'TAFLUPROST 0.0015% EYE DROPS','Tafluprost','Preservative-Free Prostaglandin Glaucoma','0-0-1',0,'after_food'),
('Ophthalmologist',61,'LATANOPROST + TIMOLOL EYE DROPS','Latanoprost + Timolol','Prostaglandin + Beta Blocker Fixed Dose Glaucoma','0-0-1',0,'after_food'),
('Ophthalmologist',62,'BIMATOPROST + TIMOLOL EYE DROPS','Bimatoprost + Timolol','Prostamide + Beta Blocker Fixed Dose Glaucoma','0-0-1',0,'after_food'),
('Ophthalmologist',63,'PILOCARPINE 2% EYE DROPS','Pilocarpine','Cholinergic Miotic Glaucoma','1-1-1',0,'after_food'),
('Ophthalmologist',64,'PILOCARPINE 4% EYE DROPS','Pilocarpine','Cholinergic Miotic Glaucoma High Strength','1-1-1',0,'after_food'),
('Ophthalmologist',65,'ACETAZOLAMIDE 250MG','Acetazolamide','Carbonic Anhydrase Inhibitor Oral Glaucoma','1-1-1',7,'after_food'),
('Ophthalmologist',66,'ACETAZOLAMIDE 500MG SR','Acetazolamide','Carbonic Anhydrase Inhibitor SR','1-0-1',7,'after_food'),
('Ophthalmologist',67,'METHAZOLAMIDE 25MG','Methazolamide','Carbonic Anhydrase Inhibitor','1-0-1',7,'after_food'),
('Ophthalmologist',68,'MANNITOL 20% 250ML INJ','Mannitol','Osmotic Diuretic IV Acute Glaucoma','sos',0,'after_food'),
('Ophthalmologist',69,'GLYCEROL 50% ORAL','Glycerol','Oral Osmotic Agent Acute Glaucoma','sos',0,'after_food'),
('Ophthalmologist',70,'TROPICAMIDE 0.5% EYE DROPS','Tropicamide','Anticholinergic Mydriatic/Cycloplegic','sos',0,'after_food'),
('Ophthalmologist',71,'TROPICAMIDE 1% EYE DROPS','Tropicamide','Anticholinergic Mydriatic/Cycloplegic','sos',0,'after_food'),
('Ophthalmologist',72,'CYCLOPENTOLATE 0.5% EYE DROPS','Cyclopentolate','Anticholinergic Cycloplegic','sos',0,'after_food'),
('Ophthalmologist',73,'CYCLOPENTOLATE 1% EYE DROPS','Cyclopentolate','Anticholinergic Cycloplegic','sos',0,'after_food'),
('Ophthalmologist',74,'ATROPINE 0.5% EYE DROPS','Atropine Sulfate','Anticholinergic Long-Acting Cycloplegic','1-0-0',7,'after_food'),
('Ophthalmologist',75,'ATROPINE 1% EYE DROPS','Atropine Sulfate','Anticholinergic Long-Acting Cycloplegic/Myopia Control','1-0-0',0,'after_food'),
('Ophthalmologist',76,'PHENYLEPHRINE 2.5% EYE DROPS','Phenylephrine','Adrenergic Mydriatic','sos',0,'after_food'),
('Ophthalmologist',77,'PHENYLEPHRINE 10% EYE DROPS','Phenylephrine','Adrenergic Mydriatic Strong','sos',0,'after_food'),
('Ophthalmologist',78,'CARBOXYMETHYLCELLULOSE 0.5% EYE DROPS','Carboxymethylcellulose','Lubricant Eye Drops','1-1-1',0,'after_food'),
('Ophthalmologist',79,'CARBOXYMETHYLCELLULOSE 1% EYE DROPS','Carboxymethylcellulose','Lubricant Eye Drops High Viscosity','1-1-1',0,'after_food'),
('Ophthalmologist',80,'HYDROXYPROPYL METHYLCELLULOSE 0.3% EYE DROPS','HPMC','Lubricant Eye Drops','1-1-1',0,'after_food'),
('Ophthalmologist',81,'SODIUM HYALURONATE 0.1% EYE DROPS','Sodium Hyaluronate','Lubricant Eye Drops Hyaluronic Acid','1-1-1',0,'after_food'),
('Ophthalmologist',82,'SODIUM HYALURONATE 0.18% EYE DROPS','Sodium Hyaluronate','Lubricant Eye Drops High Viscosity','1-1-1',0,'after_food'),
('Ophthalmologist',83,'SODIUM HYALURONATE 0.4% EYE DROPS PF','Sodium Hyaluronate','Preservative-Free Lubricant Eye Drops','1-1-1',0,'after_food'),
('Ophthalmologist',84,'CARBOMER 0.2% EYE GEL','Carbomer','Lubricant Eye Gel Night','0-0-1',0,'after_food'),
('Ophthalmologist',85,'POLYVINYL ALCOHOL 1.4% EYE DROPS','Polyvinyl Alcohol','Lubricant Eye Drops','1-1-1',0,'after_food'),
('Ophthalmologist',86,'MINERAL OIL + WHITE SOFT PARAFFIN EYE OINTMENT','Mineral Oil + White Petrolatum','Lubricant Eye Ointment Night','0-0-1',0,'after_food'),
('Ophthalmologist',87,'TREHALOSE 3% EYE DROPS','Trehalose','Preservative-Free Lubricant Dry Eye','1-1-1',0,'after_food'),
('Ophthalmologist',88,'CYCLOSPORINE 0.05% EYE DROPS','Cyclosporine A','Topical Immunomodulator Dry Eye','1-0-1',0,'after_food'),
('Ophthalmologist',89,'CYCLOSPORINE 0.1% EYE DROPS','Cyclosporine A','Topical Immunomodulator Severe Dry Eye','1-0-1',0,'after_food'),
('Ophthalmologist',90,'VITAMIN A 0.6% EYE OINTMENT','Retinol Palmitate','Topical Vitamin A Eye Ointment','0-0-1',30,'after_food'),
('Ophthalmologist',91,'PREDNISOLONE 10MG ORAL','Prednisolone','Oral Corticosteroid Uveitis/Allergy','1-0-0',14,'after_food'),
('Ophthalmologist',92,'PREDNISOLONE 20MG ORAL','Prednisolone','Oral Corticosteroid','1-0-0',7,'after_food'),
('Ophthalmologist',93,'PREDNISOLONE 40MG ORAL','Prednisolone','Oral Corticosteroid High Dose Uveitis','1-0-0',7,'after_food'),
('Ophthalmologist',94,'DEXAMETHASONE 0.5MG ORAL','Dexamethasone','Oral Corticosteroid','1-0-0',5,'after_food'),
('Ophthalmologist',95,'HYDROXYCHLOROQUINE 200MG','Hydroxychloroquine','Antimalarial/Uveitis','1-0-0',30,'after_food'),
('Ophthalmologist',96,'AZATHIOPRINE 50MG','Azathioprine','Immunosuppressant Uveitis','1-0-1',90,'after_food'),
('Ophthalmologist',97,'METHOTREXATE 7.5MG','Methotrexate','DMARD Ocular Inflammation','1-0-0',90,'after_food'),
('Ophthalmologist',98,'MYCOPHENOLATE MOFETIL 500MG','Mycophenolate Mofetil','Immunosuppressant Uveitis','1-0-1',90,'after_food'),
('Ophthalmologist',99,'DOXYCYCLINE 100MG','Doxycycline','Antibiotic Meibomian Gland Dysfunction','0-0-1',90,'after_food'),
('Ophthalmologist',100,'AZITHROMYCIN 500MG ORAL','Azithromycin','Macrolide Chlamydial Conjunctivitis','1-0-0',3,'empty_stomach'),
('Ophthalmologist',101,'ACYCLOVIR 400MG ORAL','Acyclovir','Antiviral Herpes Simplex Keratitis','1-1-1-1-1',7,'after_food'),
('Ophthalmologist',102,'VALACYCLOVIR 500MG ORAL','Valacyclovir','Antiviral Herpes Simplex','1-0-1',7,'after_food'),
('Ophthalmologist',103,'ACYCLOVIR 800MG ORAL','Acyclovir','Antiviral Herpes Zoster Ophthalmicus','1-1-1-1-1',7,'after_food'),
('Ophthalmologist',104,'BEVACIZUMAB 25MG/ML INTRAVITREAL INJ','Bevacizumab','Anti-VEGF Intravitreal AMD/DR','sos',0,'after_food'),
('Ophthalmologist',105,'RANIBIZUMAB 0.5MG INTRAVITREAL INJ','Ranibizumab','Anti-VEGF Intravitreal AMD/DR','sos',0,'after_food'),
('Ophthalmologist',106,'AFLIBERCEPT 2MG INTRAVITREAL INJ','Aflibercept','Anti-VEGF Trap Intravitreal','sos',0,'after_food'),
('Ophthalmologist',107,'TRIAMCINOLONE ACETONIDE 4MG INTRAVITREAL INJ','Triamcinolone Acetonide','Intravitreal Corticosteroid','sos',0,'after_food'),
('Ophthalmologist',108,'VANCOMYCIN 1MG/0.1ML INTRAVITREAL INJ','Vancomycin','Intravitreal Antibiotic Endophthalmitis','sos',0,'after_food'),
('Ophthalmologist',109,'CEFTAZIDIME 2.25MG/0.1ML INTRAVITREAL INJ','Ceftazidime','Intravitreal Antibiotic Endophthalmitis','sos',0,'after_food'),
('Ophthalmologist',110,'PROXYMETACAINE 0.5% EYE DROPS','Proxymetacaine','Topical Ocular Anesthetic','sos',0,'after_food'),
('Ophthalmologist',111,'TETRACAINE 0.5% EYE DROPS','Tetracaine','Topical Ocular Anesthetic','sos',0,'after_food'),
('Ophthalmologist',112,'FLUORESCEIN SODIUM 0.5% EYE DROPS','Fluorescein Sodium','Diagnostic Dye Tonometry/Staining','sos',0,'after_food'),
('Ophthalmologist',113,'ROSE BENGAL 1% EYE DROPS','Rose Bengal','Diagnostic Dye Dry Eye/Corneal Staining','sos',0,'after_food'),
('Ophthalmologist',114,'LISSAMINE GREEN 1% EYE DROPS','Lissamine Green','Diagnostic Dye Ocular Surface','sos',0,'after_food'),
('Ophthalmologist',115,'ZINC SULFATE 0.25% EYE DROPS','Zinc Sulfate','Topical Astringent/Antiseptic','1-1-1',7,'after_food'),
('Ophthalmologist',116,'POVIDONE IODINE 5% OPHTHALMIC SOLUTION','Povidone Iodine','Topical Ocular Antiseptic Pre-Procedure','sos',0,'after_food'),
('Ophthalmologist',117,'LIGNOCAINE 2% GEL OPHTHALMIC','Lignocaine','Topical Ocular Local Anesthetic Gel','sos',0,'after_food'),
('Ophthalmologist',118,'LUTEIN 10MG + ZEAXANTHIN 2MG','Lutein + Zeaxanthin','Macular Carotenoid Supplement AMD','1-0-0',90,'after_food'),
('Ophthalmologist',119,'OMEGA-3 FATTY ACIDS 1GM','Omega-3 EPA/DHA','Anti-Inflammatory Supplement Dry Eye','0-0-1',90,'after_food'),
('Ophthalmologist',120,'VITAMIN C 500MG','Ascorbic Acid','Antioxidant Cataract Prevention','1-0-0',90,'after_food'),
('Ophthalmologist',121,'VITAMIN E 400IU','Tocopherol','Antioxidant Retinal Protection','1-0-0',90,'after_food'),
('Ophthalmologist',122,'ZINC 20MG + COPPER 2MG','Zinc + Copper','Trace Mineral AMD Supplement','1-0-0',90,'after_food'),
('Ophthalmologist',123,'BETA CAROTENE 15MG','Beta Carotene','Antioxidant Vitamin A Precursor','1-0-0',90,'after_food'),
('Ophthalmologist',124,'BILBERRY EXTRACT 80MG','Anthocyanosides','Herbal Retinal Supplement','1-0-0',90,'after_food'),
('Ophthalmologist',125,'METHYLCOBALAMIN 500MCG','Methylcobalamin','Vitamin B12 Optic Nerve','1-0-0',30,'after_food'),
('Ophthalmologist',126,'FOLIC ACID 5MG','Folic Acid','B Vitamin Optic Nerve Health','1-0-0',90,'after_food'),
('Ophthalmologist',127,'PANTOPRAZOLE 40MG','Pantoprazole','PPI GI Protection with Oral Steroids','1-0-0',14,'before_food'),
('Ophthalmologist',128,'CALCIUM + D3 500MG','Calcium + Cholecalciferol','Bone Protection with Oral Steroids','1-0-1',90,'after_food'),
('Ophthalmologist',129,'ADRENALINE 1MG/ML INJ','Epinephrine','Emergency Anaphylaxis','sos',0,'after_food'),
('Ophthalmologist',130,'DEXAMETHASONE 8MG INJ','Dexamethasone','IV Corticosteroid Optic Neuritis','sos',0,'after_food'),
('Ophthalmologist',131,'METHYLPREDNISOLONE 500MG INJ (IV PULSE)','Methylprednisolone','IV Pulse Corticosteroid Optic Neuritis','sos',0,'after_food'),
('Ophthalmologist',132,'AMPHOTERICIN B 0.15% EYE DROPS','Amphotericin B','Topical Antifungal Eye Drops Fungal Keratitis','1-1-1',21,'after_food'),
('Ophthalmologist',133,'FLUCONAZOLE 0.2% EYE DROPS','Fluconazole','Topical Ophthalmic Antifungal','1-1-1',14,'after_food'),
('Ophthalmologist',134,'ITRACONAZOLE 100MG ORAL','Itraconazole','Systemic Antifungal Endophthalmitis','1-0-1',30,'after_food'),
('Ophthalmologist',135,'VORICONAZOLE 200MG ORAL','Voriconazole','Systemic Antifungal Fungal Keratitis','1-0-1',21,'after_food'),
('Ophthalmologist',136,'DICLOFENAC 50MG ORAL','Diclofenac','Oral NSAID Post-Surgical','1-0-1',7,'after_food'),
('Ophthalmologist',137,'IBUPROFEN 400MG ORAL','Ibuprofen','Oral NSAID Post-Surgical Pain','1-1-1',5,'after_food'),
('Ophthalmologist',138,'ONDANSETRON 4MG','Ondansetron','Antiemetic Post-Surgical Nausea','1-0-1',3,'before_food'),
('Ophthalmologist',139,'ACETYLCYSTEINE 600MG','N-Acetylcysteine','Mucolytic/Dry Eye Adjunct','1-0-0',30,'after_food'),
('Ophthalmologist',140,'VITAMIN D3 60000IU','Cholecalciferol','Vitamin D Weekly Supplement','1-0-0',28,'after_food'),
('Ophthalmologist',141,'SELENIUM 100MCG','Selenium','Antioxidant Retinal Protection','1-0-0',90,'after_food'),
('Ophthalmologist',142,'ASTAXANTHIN 4MG','Astaxanthin','Carotenoid Retinal Antioxidant','1-0-0',90,'after_food'),
('Ophthalmologist',143,'MACULAR DEGENERATION FORMULA (AREDS2)','Vitamin C + E + Zinc + Copper + Lutein + Zeaxanthin','AREDS2 AMD Supplement Formula','1-0-0',0,'after_food'),
('Ophthalmologist',144,'OLOPATADINE 0.6% NASAL SPRAY','Olopatadine','Nasal Antihistamine Allergic Rhino-Conjunctivitis','1-0-1',30,'after_food'),
('Ophthalmologist',145,'CETIRIZINE 10MG ORAL','Cetirizine','Oral Antihistamine Ocular Allergy','0-0-1',14,'after_food'),
('Ophthalmologist',146,'LOTEPREDNOL + TOBRAMYCIN EYE DROPS','Loteprednol + Tobramycin','Topical Soft Steroid + Antibiotic Post-Op','1-1-1',7,'after_food'),
('Ophthalmologist',147,'GATIFLOXACIN + PREDNISOLONE EYE DROPS','Gatifloxacin + Prednisolone','Topical Fluoroquinolone + Steroid Post-Op','1-1-1',7,'after_food'),
('Ophthalmologist',148,'SILVER NITRATE 1% EYE DROPS','Silver Nitrate','Topical Cauterizing/Antiseptic','sos',0,'after_food'),
('Ophthalmologist',149,'HYALURONIDASE 1500IU INJ','Hyaluronidase','Spreading Factor Local Block','sos',0,'after_food'),
('Ophthalmologist',150,'BUPIVACAINE 0.75% OPHTHALMIC INJ','Bupivacaine','Long-Acting Local Anesthetic Retrobulbar','sos',0,'after_food');

-- ═══════════════════════════════════════════════════════════
-- PART E: NEUROLOGIST (150 rows)
-- ═══════════════════════════════════════════════════════════
INSERT INTO specialty_starter_packs(specialty, rank, drug_name, generic_name, category, default_dosage, default_duration, default_timing) VALUES
('Neurologist',1,'LEVETIRACETAM 250MG','Levetiracetam','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',2,'LEVETIRACETAM 500MG','Levetiracetam','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',3,'LEVETIRACETAM 1000MG','Levetiracetam','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',4,'SODIUM VALPROATE 200MG','Sodium Valproate','Anticonvulsant/Mood Stabilizer','1-0-1',30,'after_food'),
('Neurologist',5,'SODIUM VALPROATE 500MG','Sodium Valproate','Anticonvulsant/Mood Stabilizer','1-0-1',30,'after_food'),
('Neurologist',6,'SODIUM VALPROATE 500MG CR','Sodium Valproate CR','Anticonvulsant CR','1-0-1',30,'after_food'),
('Neurologist',7,'CARBAMAZEPINE 100MG','Carbamazepine','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Neurologist',8,'CARBAMAZEPINE 200MG','Carbamazepine','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',9,'CARBAMAZEPINE 400MG CR','Carbamazepine CR','Anticonvulsant CR','1-0-1',30,'after_food'),
('Neurologist',10,'PHENYTOIN 100MG','Phenytoin','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',11,'PHENYTOIN 300MG SR','Phenytoin SR','Anticonvulsant SR','0-0-1',30,'after_food'),
('Neurologist',12,'OXCARBAZEPINE 150MG','Oxcarbazepine','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',13,'OXCARBAZEPINE 300MG','Oxcarbazepine','Anticonvulsant','1-0-1',30,'after_food'),
('Neurologist',14,'LAMOTRIGINE 25MG','Lamotrigine','Anticonvulsant/Bipolar','1-0-0',30,'after_food'),
('Neurologist',15,'LAMOTRIGINE 50MG','Lamotrigine','Anticonvulsant/Bipolar','1-0-0',30,'after_food'),
('Neurologist',16,'LAMOTRIGINE 100MG','Lamotrigine','Anticonvulsant/Bipolar','1-0-0',30,'after_food'),
('Neurologist',17,'LAMOTRIGINE 200MG','Lamotrigine','Anticonvulsant/Bipolar','1-0-0',30,'after_food'),
('Neurologist',18,'TOPIRAMATE 25MG','Topiramate','Anticonvulsant/Migraine Prophylaxis','0-0-1',30,'after_food'),
('Neurologist',19,'TOPIRAMATE 50MG','Topiramate','Anticonvulsant/Migraine Prophylaxis','0-0-1',30,'after_food'),
('Neurologist',20,'TOPIRAMATE 100MG','Topiramate','Anticonvulsant/Migraine Prophylaxis','1-0-0',30,'after_food'),
('Neurologist',21,'CLONAZEPAM 0.25MG','Clonazepam','Benzodiazepine Anticonvulsant Schedule H1','0-0-1',30,'after_food'),
('Neurologist',22,'CLONAZEPAM 0.5MG','Clonazepam','Benzodiazepine Anticonvulsant Schedule H1','0-0-1',30,'after_food'),
('Neurologist',23,'CLONAZEPAM 2MG','Clonazepam','Benzodiazepine Anticonvulsant High Dose','0-0-1',30,'after_food'),
('Neurologist',24,'CLOBAZAM 10MG','Clobazam','1,5-Benzodiazepine Anticonvulsant Adjunct','0-0-1',30,'after_food'),
('Neurologist',25,'CLOBAZAM 20MG','Clobazam','1,5-Benzodiazepine Anticonvulsant Adjunct','0-0-1',30,'after_food'),
('Neurologist',26,'GABAPENTIN 300MG','Gabapentin','Anticonvulsant/Neuropathic/Restless Legs','0-0-1',30,'after_food'),
('Neurologist',27,'GABAPENTIN 400MG','Gabapentin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Neurologist',28,'GABAPENTIN 600MG','Gabapentin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Neurologist',29,'PREGABALIN 75MG','Pregabalin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Neurologist',30,'PREGABALIN 150MG','Pregabalin','Anticonvulsant/Neuropathic','1-0-1',30,'after_food'),
('Neurologist',31,'PREGABALIN 300MG','Pregabalin','Anticonvulsant/Neuropathic High Dose','1-0-1',30,'after_food'),
('Neurologist',32,'LACOSAMIDE 50MG','Lacosamide','Anticonvulsant Adjunct','1-0-1',30,'after_food'),
('Neurologist',33,'LACOSAMIDE 100MG','Lacosamide','Anticonvulsant Adjunct','1-0-1',30,'after_food'),
('Neurologist',34,'PHENOBARBITONE 30MG','Phenobarbitone','Anticonvulsant','0-0-1',30,'after_food'),
('Neurologist',35,'PHENOBARBITONE 60MG','Phenobarbitone','Anticonvulsant','0-0-1',30,'after_food'),
('Neurologist',36,'ZONISAMIDE 100MG','Zonisamide','Anticonvulsant Adjunct','1-0-0',30,'after_food'),
('Neurologist',37,'PERAMPANEL 2MG','Perampanel','AMPA Antagonist Anticonvulsant','0-0-1',30,'after_food'),
('Neurologist',38,'SUMATRIPTAN 50MG','Sumatriptan','Triptan 5HT1B/1D Agonist Migraine','sos',0,'after_food'),
('Neurologist',39,'SUMATRIPTAN 100MG','Sumatriptan','Triptan Migraine Acute','sos',0,'after_food'),
('Neurologist',40,'RIZATRIPTAN 10MG','Rizatriptan','Triptan Migraine Acute','sos',0,'after_food'),
('Neurologist',41,'ZOLMITRIPTAN 2.5MG','Zolmitriptan','Triptan Migraine Acute','sos',0,'after_food'),
('Neurologist',42,'NARATRIPTAN 2.5MG','Naratriptan','Triptan Long-Acting Migraine','sos',0,'after_food'),
('Neurologist',43,'ALMOTRIPTAN 12.5MG','Almotriptan','Triptan Migraine Acute','sos',0,'after_food'),
('Neurologist',44,'PROPRANOLOL 40MG','Propranolol','Beta Blocker Migraine Prophylaxis','1-0-1',90,'after_food'),
('Neurologist',45,'PROPRANOLOL 80MG','Propranolol','Beta Blocker Migraine Prophylaxis','1-0-1',90,'after_food'),
('Neurologist',46,'PROPRANOLOL 40MG LA','Propranolol LA','Beta Blocker Long-Acting Migraine','1-0-0',90,'after_food'),
('Neurologist',47,'AMITRIPTYLINE 10MG','Amitriptyline','TCA Migraine/Neuropathic Prophylaxis','0-0-1',90,'after_food'),
('Neurologist',48,'AMITRIPTYLINE 25MG','Amitriptyline','TCA Migraine/Neuropathic Prophylaxis','0-0-1',90,'after_food'),
('Neurologist',49,'NORTRIPTYLINE 10MG','Nortriptyline','TCA Migraine Prophylaxis','0-0-1',90,'after_food'),
('Neurologist',50,'FLUNARIZINE 5MG','Flunarizine','Calcium Channel Blocker Migraine Prophylaxis','0-0-1',90,'after_food'),
('Neurologist',51,'FLUNARIZINE 10MG','Flunarizine','Calcium Channel Blocker Migraine Prophylaxis','0-0-1',90,'after_food'),
('Neurologist',52,'CANDESARTAN 8MG','Candesartan','ARB Migraine Prophylaxis','1-0-0',90,'after_food'),
('Neurologist',53,'CINNARIZINE 25MG + DIMENHYDRINATE 40MG','Cinnarizine + Dimenhydrinate','Anti-Vertigo Combination','1-0-1',14,'after_food'),
('Neurologist',54,'LEVODOPA 100MG + CARBIDOPA 25MG','Levodopa + Carbidopa','Dopamine Precursor Parkinson','1-0-1',30,'before_food'),
('Neurologist',55,'LEVODOPA 250MG + CARBIDOPA 25MG','Levodopa + Carbidopa','Dopamine Precursor Parkinson','1-0-1',30,'before_food'),
('Neurologist',56,'LEVODOPA + CARBIDOPA CR','Levodopa + Carbidopa CR','Controlled Release Parkinson','1-0-1',30,'before_food'),
('Neurologist',57,'PRAMIPEXOLE 0.125MG','Pramipexole','Dopamine Agonist Parkinson/RLS','1-1-1',30,'after_food'),
('Neurologist',58,'PRAMIPEXOLE 0.5MG','Pramipexole','Dopamine Agonist Parkinson','1-0-1',30,'after_food'),
('Neurologist',59,'PRAMIPEXOLE ER 0.75MG','Pramipexole ER','Dopamine Agonist ER Parkinson','1-0-0',30,'after_food'),
('Neurologist',60,'ROPINIROLE 0.25MG','Ropinirole','Dopamine Agonist Parkinson/RLS','1-0-1',30,'after_food'),
('Neurologist',61,'ROPINIROLE 1MG','Ropinirole','Dopamine Agonist Parkinson','1-0-1',30,'after_food'),
('Neurologist',62,'RASAGILINE 0.5MG','Rasagiline','MAO-B Inhibitor Parkinson','1-0-0',30,'after_food'),
('Neurologist',63,'RASAGILINE 1MG','Rasagiline','MAO-B Inhibitor Parkinson','1-0-0',30,'after_food'),
('Neurologist',64,'SELEGILINE 5MG','Selegiline','MAO-B Inhibitor Parkinson','1-0-0',30,'after_food'),
('Neurologist',65,'AMANTADINE 100MG','Amantadine','NMDA Antagonist Parkinson/Dyskinesia','1-0-0',30,'after_food'),
('Neurologist',66,'ENTACAPONE 200MG','Entacapone','COMT Inhibitor Parkinson Adjunct','1-0-1',30,'after_food'),
('Neurologist',67,'TRIHEXYPHENIDYL 2MG','Trihexyphenidyl','Anticholinergic Parkinson/Tremor','1-0-1',30,'after_food'),
('Neurologist',68,'DONEPEZIL 5MG','Donepezil','ChEI Alzheimer Dementia','0-0-1',90,'after_food'),
('Neurologist',69,'DONEPEZIL 10MG','Donepezil','ChEI Alzheimer Dementia','0-0-1',90,'after_food'),
('Neurologist',70,'RIVASTIGMINE 1.5MG','Rivastigmine','ChEI Alzheimer/DLB Dementia','1-0-1',90,'after_food'),
('Neurologist',71,'RIVASTIGMINE 3MG','Rivastigmine','ChEI Alzheimer/DLB Dementia','1-0-1',90,'after_food'),
('Neurologist',72,'GALANTAMINE 8MG','Galantamine','ChEI + Nicotinic Modulator Dementia','1-0-0',90,'after_food'),
('Neurologist',73,'GALANTAMINE 16MG','Galantamine','ChEI Alzheimer Dementia','1-0-0',90,'after_food'),
('Neurologist',74,'MEMANTINE 5MG','Memantine','NMDA Antagonist Moderate-Severe Dementia','1-0-0',90,'after_food'),
('Neurologist',75,'MEMANTINE 10MG','Memantine','NMDA Antagonist Dementia','1-0-0',90,'after_food'),
('Neurologist',76,'DONEPEZIL + MEMANTINE','Donepezil + Memantine','ChEI + NMDA Antagonist Dementia Combination','0-0-1',90,'after_food'),
('Neurologist',77,'ASPIRIN 75MG','Aspirin','Antiplatelet Stroke Prevention','1-0-0',365,'after_food'),
('Neurologist',78,'ASPIRIN 150MG','Aspirin','Antiplatelet Acute Stroke','1-0-0',30,'after_food'),
('Neurologist',79,'CLOPIDOGREL 75MG','Clopidogrel','Antiplatelet TIA/Stroke','1-0-0',365,'after_food'),
('Neurologist',80,'ASPIRIN 75MG + CLOPIDOGREL 75MG','Aspirin + Clopidogrel','Dual Antiplatelet TIA/Stroke','1-0-0',21,'after_food'),
('Neurologist',81,'TICAGRELOR 90MG','Ticagrelor','Antiplatelet Acute TIA/Stroke','1-0-1',90,'after_food'),
('Neurologist',82,'WARFARIN 2MG','Warfarin','Anticoagulant AF Stroke Prevention','1-0-0',365,'after_food'),
('Neurologist',83,'RIVAROXABAN 20MG','Rivaroxaban','NOAC AF Stroke Prevention','1-0-0',365,'after_food'),
('Neurologist',84,'APIXABAN 5MG','Apixaban','NOAC AF Stroke Prevention','1-0-1',365,'after_food'),
('Neurologist',85,'DABIGATRAN 150MG','Dabigatran','NOAC AF Stroke Prevention','1-0-1',365,'after_food'),
('Neurologist',86,'ATORVASTATIN 40MG','Atorvastatin','Statin Stroke Prevention','0-0-1',365,'after_food'),
('Neurologist',87,'ROSUVASTATIN 20MG','Rosuvastatin','Statin Stroke Prevention','0-0-1',365,'after_food'),
('Neurologist',88,'DULOXETINE 30MG','Duloxetine','SNRI Neuropathic/Depression','1-0-0',30,'after_food'),
('Neurologist',89,'DULOXETINE 60MG','Duloxetine','SNRI Neuropathic/Depression','1-0-0',30,'after_food'),
('Neurologist',90,'METHYLCOBALAMIN 500MCG','Methylcobalamin','Vitamin B12 Neuroprotective','1-0-1',30,'after_food'),
('Neurologist',91,'METHYLCOBALAMIN 1500MCG','Methylcobalamin','Vitamin B12 High Dose Neuropathy','1-0-0',30,'after_food'),
('Neurologist',92,'ALPHA LIPOIC ACID 600MG','Alpha Lipoic Acid','Antioxidant Neuropathic','1-0-0',30,'after_food'),
('Neurologist',93,'PYRIDOXINE 40MG','Pyridoxine B6','Vitamin B6 Neuropathy','1-0-0',30,'after_food'),
('Neurologist',94,'THIAMINE 100MG','Thiamine B1','Vitamin B1 Neuropathy','1-0-0',30,'after_food'),
('Neurologist',95,'BENFOTIAMINE 150MG','Benfotiamine','Fat-Soluble B1 Peripheral Neuropathy','1-0-1',90,'after_food'),
('Neurologist',96,'PROPRANOLOL 10MG','Propranolol','Beta Blocker Essential Tremor','1-1-1',30,'after_food'),
('Neurologist',97,'PRIMIDONE 50MG','Primidone','Anticonvulsant Essential Tremor','0-0-1',30,'after_food'),
('Neurologist',98,'BACLOFEN 10MG','Baclofen','GABA-B Agonist Spasticity','1-0-1',30,'after_food'),
('Neurologist',99,'TIZANIDINE 2MG','Tizanidine','Central Alpha Agonist Spasticity','0-0-1',30,'after_food'),
('Neurologist',100,'PYRIDOSTIGMINE 60MG','Pyridostigmine','ChEI Myasthenia Gravis','1-1-1',30,'before_food'),
('Neurologist',101,'BETAHISTINE 16MG','Betahistine','Anti-Vertigo Meniere','1-1-1',30,'after_food'),
('Neurologist',102,'DIAZEPAM 5MG','Diazepam','Benzodiazepine Status Epilepticus/Acute Schedule H1','sos',0,'before_food'),
('Neurologist',103,'LORAZEPAM 1MG','Lorazepam','Benzodiazepine Status Epilepticus Schedule H1','sos',0,'after_food'),
('Neurologist',104,'PHENYTOIN 50MG/ML INJ','Phenytoin','Anticonvulsant IV Status','sos',0,'after_food'),
('Neurologist',105,'LEVETIRACETAM 500MG/5ML INJ','Levetiracetam','Anticonvulsant IV Status','sos',0,'after_food'),
('Neurologist',106,'VALPROATE 400MG/4ML INJ','Sodium Valproate','Anticonvulsant IV Status','sos',0,'after_food'),
('Neurologist',107,'MAGNESIUM SULFATE 50% INJ','Magnesium Sulfate','IV Anticonvulsant Eclampsia/Refractory','sos',0,'after_food'),
('Neurologist',108,'MANNITOL 20% INJ','Mannitol','Osmotic Diuretic Cerebral Edema','sos',0,'after_food'),
('Neurologist',109,'DEXAMETHASONE 4MG INJ','Dexamethasone','Corticosteroid Cerebral Edema/Neuritis','sos',0,'after_food'),
('Neurologist',110,'ACYCLOVIR 500MG INJ','Acyclovir','Antiviral IV Encephalitis','sos',14,'after_food'),
('Neurologist',111,'RILUZOLE 50MG','Riluzole','Antiglutamatergic ALS','1-0-1',0,'empty_stomach'),
('Neurologist',112,'INTERFERON BETA-1A 22MCG INJ','Interferon Beta-1A','Immunomodulator Multiple Sclerosis','sos',0,'after_food'),
('Neurologist',113,'GLATIRAMER ACETATE 20MG INJ','Glatiramer Acetate','Immunomodulator Multiple Sclerosis','sos',0,'after_food'),
('Neurologist',114,'DIMETHYL FUMARATE 120MG','Dimethyl Fumarate','Immunomodulator Multiple Sclerosis','1-0-1',0,'after_food'),
('Neurologist',115,'FINGOLIMOD 0.5MG','Fingolimod','S1P Modulator Multiple Sclerosis','1-0-0',0,'after_food'),
('Neurologist',116,'HYDROXYCHLOROQUINE 200MG','Hydroxychloroquine','Antimalarial/Neurosarcoidosis/CNS Lupus','1-0-0',90,'after_food'),
('Neurologist',117,'PREDNISOLONE 40MG','Prednisolone','Corticosteroid Optic Neuritis/CIDP','1-0-0',14,'after_food'),
('Neurologist',118,'AZATHIOPRINE 50MG','Azathioprine','Immunosuppressant NMO/MG/MS','1-0-1',90,'after_food'),
('Neurologist',119,'MYCOPHENOLATE MOFETIL 500MG','Mycophenolate Mofetil','Immunosuppressant Neuromyelitis Optica','1-0-1',90,'after_food'),
('Neurologist',120,'INTRAVENOUS IMMUNOGLOBULIN (IVIG)','Human Normal Immunoglobulin','IVIG GBS/MG/CIDP','sos',0,'after_food'),
('Neurologist',121,'ERENUMAB 70MG INJ','Erenumab','CGRP Antibody Migraine Prophylaxis','sos',0,'after_food'),
('Neurologist',122,'FREMANEZUMAB 225MG INJ','Fremanezumab','CGRP Antibody Migraine Prophylaxis','sos',0,'after_food'),
('Neurologist',123,'BOTULINUM TOXIN A 100U INJ','Botulinum Toxin A','Neurotoxin Chronic Migraine/Spasticity','sos',0,'after_food'),
('Neurologist',124,'PARACETAMOL 500MG','Paracetamol','Analgesic Headache','1-1-1',5,'after_food'),
('Neurologist',125,'IBUPROFEN 400MG','Ibuprofen','NSAID Headache/Migraine Acute','1-1-1',5,'after_food'),
('Neurologist',126,'NAPROXEN SODIUM 550MG','Naproxen Sodium','NSAID Migraine Acute','1-0-1',5,'after_food'),
('Neurologist',127,'DICLOFENAC 50MG','Diclofenac','NSAID Headache Acute','1-1-1',5,'after_food'),
('Neurologist',128,'METOCLOPRAMIDE 10MG','Metoclopramide','Prokinetic Antiemetic Migraine','1-1-1',5,'before_food'),
('Neurologist',129,'ONDANSETRON 4MG','Ondansetron','Antiemetic Migraine/Vertigo','1-0-1',3,'before_food'),
('Neurologist',130,'CINNARIZINE 25MG','Cinnarizine','Anti-Vertigo Antihistamine CCB','1-1-1',30,'after_food'),
('Neurologist',131,'PROCHLORPERAZINE 5MG','Prochlorperazine','Dopamine Antagonist Vertigo/Nausea','1-0-1',7,'after_food'),
('Neurologist',132,'ESCITALOPRAM 10MG','Escitalopram','SSRI Depression/Anxiety in Neurology','1-0-0',90,'after_food'),
('Neurologist',133,'SERTRALINE 50MG','Sertraline','SSRI Depression Post-Stroke','1-0-0',90,'after_food'),
('Neurologist',134,'CLONAZEPAM 0.5MG','Clonazepam','Benzodiazepine RLS/Anxiety Adjunct Schedule H1','0-0-1',30,'after_food'),
('Neurologist',135,'FOLIC ACID 5MG','Folic Acid','B Vitamin Anticonvulsant Supplement','1-0-0',90,'after_food'),
('Neurologist',136,'VITAMIN D3 60000IU','Cholecalciferol','Vitamin D Weekly MS/Epilepsy','1-0-0',28,'after_food'),
('Neurologist',137,'OMEGA-3 FATTY ACIDS 1GM','Omega-3','Anti-Inflammatory Neuroprotective','0-0-1',90,'after_food'),
('Neurologist',138,'COENZYME Q10 100MG','Coenzyme Q10','Mitochondrial Supplement Migraine','1-0-0',90,'after_food'),
('Neurologist',139,'RIBOFLAVIN 200MG','Riboflavin B2','Mitochondrial Migraine Prophylaxis','1-0-0',90,'after_food'),
('Neurologist',140,'MAGNESIUM GLYCINATE 200MG','Magnesium Glycinate','Mineral Migraine/RLS/Neuroprotective','1-0-0',90,'after_food'),
('Neurologist',141,'ASPIRIN 300MG','Aspirin','Antiplatelet Acute Ischemic Stroke Loading','1-0-0',14,'after_food'),
('Neurologist',142,'ALTEPLASE 50MG INJ','Alteplase','Thrombolytic IV Acute Ischemic Stroke','sos',0,'after_food'),
('Neurologist',143,'CITICOLINE 500MG','Citicoline','Neuroprotective Cognitive','1-0-1',90,'after_food'),
('Neurologist',144,'CITICOLINE 1000MG','Citicoline','Neuroprotective Stroke Rehabilitation','1-0-1',90,'after_food'),
('Neurologist',145,'PIRACETAM 800MG','Piracetam','Nootropic Cognitive Supplement','1-0-1',90,'after_food'),
('Neurologist',146,'DONEPEZIL 23MG','Donepezil','ChEI High Dose Severe Alzheimer','0-0-1',90,'after_food'),
('Neurologist',147,'RIVASTIGMINE 4.6MG TRANSDERMAL PATCH','Rivastigmine','Transdermal ChEI Dementia/PD Dementia','sos',0,'after_food'),
('Neurologist',148,'ROTIGOTINE 2MG/24HR PATCH','Rotigotine','Transdermal Dopamine Agonist Parkinson/RLS','sos',0,'after_food'),
('Neurologist',149,'CABERGOLINE 0.5MG','Cabergoline','Dopamine Agonist Hyperprolactinemia/Parkinson','1-0-0',0,'after_food'),
('Neurologist',150,'NORTRIPTYLINE 25MG','Nortriptyline','TCA Chronic Pain/Depression/Neuropathic','0-0-1',90,'after_food');

-- ═══════════════════════════════════════════════════════════
-- PART F: PSYCHIATRIST (150 rows)
-- ═══════════════════════════════════════════════════════════
INSERT INTO specialty_starter_packs(specialty, rank, drug_name, generic_name, category, default_dosage, default_duration, default_timing) VALUES
('Psychiatrist',1,'FLUOXETINE 10MG','Fluoxetine','SSRI Antidepressant','1-0-0',30,'after_food'),
('Psychiatrist',2,'FLUOXETINE 20MG','Fluoxetine','SSRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',3,'SERTRALINE 25MG','Sertraline','SSRI Antidepressant','1-0-0',30,'after_food'),
('Psychiatrist',4,'SERTRALINE 50MG','Sertraline','SSRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',5,'SERTRALINE 100MG','Sertraline','SSRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',6,'ESCITALOPRAM 5MG','Escitalopram','SSRI Antidepressant','1-0-0',30,'after_food'),
('Psychiatrist',7,'ESCITALOPRAM 10MG','Escitalopram','SSRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',8,'ESCITALOPRAM 20MG','Escitalopram','SSRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',9,'PAROXETINE 10MG','Paroxetine','SSRI Antidepressant/Anxiety','1-0-0',30,'after_food'),
('Psychiatrist',10,'PAROXETINE 20MG','Paroxetine','SSRI Antidepressant/Anxiety','1-0-0',90,'after_food'),
('Psychiatrist',11,'FLUVOXAMINE 50MG','Fluvoxamine','SSRI Antidepressant/OCD','0-0-1',90,'after_food'),
('Psychiatrist',12,'FLUVOXAMINE 100MG','Fluvoxamine','SSRI Antidepressant/OCD','0-0-1',90,'after_food'),
('Psychiatrist',13,'CITALOPRAM 20MG','Citalopram','SSRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',14,'VENLAFAXINE 37.5MG','Venlafaxine','SNRI Antidepressant/Anxiety','1-0-1',30,'after_food'),
('Psychiatrist',15,'VENLAFAXINE 75MG','Venlafaxine','SNRI Antidepressant/Anxiety','1-0-0',90,'after_food'),
('Psychiatrist',16,'VENLAFAXINE XR 75MG','Venlafaxine XR','SNRI XR Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',17,'VENLAFAXINE XR 150MG','Venlafaxine XR','SNRI XR Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',18,'DULOXETINE 20MG','Duloxetine','SNRI Antidepressant/Neuropathic','1-0-0',30,'after_food'),
('Psychiatrist',19,'DULOXETINE 30MG','Duloxetine','SNRI Antidepressant/Neuropathic','1-0-0',90,'after_food'),
('Psychiatrist',20,'DULOXETINE 60MG','Duloxetine','SNRI Antidepressant/Neuropathic','1-0-0',90,'after_food'),
('Psychiatrist',21,'DESVENLAFAXINE 50MG','Desvenlafaxine','SNRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',22,'DESVENLAFAXINE 100MG','Desvenlafaxine','SNRI Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',23,'MIRTAZAPINE 7.5MG','Mirtazapine','NaSSA Antidepressant','0-0-1',30,'after_food'),
('Psychiatrist',24,'MIRTAZAPINE 15MG','Mirtazapine','NaSSA Antidepressant','0-0-1',90,'after_food'),
('Psychiatrist',25,'MIRTAZAPINE 30MG','Mirtazapine','NaSSA Antidepressant','0-0-1',90,'after_food'),
('Psychiatrist',26,'BUPROPION 150MG SR','Bupropion','NDRI Antidepressant/Smoking Cessation','1-0-0',90,'after_food'),
('Psychiatrist',27,'BUPROPION 300MG XL','Bupropion XL','NDRI Antidepressant XL','1-0-0',90,'after_food'),
('Psychiatrist',28,'AGOMELATINE 25MG','Agomelatine','Melatonergic Antidepressant','0-0-1',90,'after_food'),
('Psychiatrist',29,'VORTIOXETINE 5MG','Vortioxetine','Multimodal Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',30,'VORTIOXETINE 10MG','Vortioxetine','Multimodal Antidepressant','1-0-0',90,'after_food'),
('Psychiatrist',31,'AMITRIPTYLINE 10MG','Amitriptyline','TCA Antidepressant/Neuropathic','0-0-1',90,'after_food'),
('Psychiatrist',32,'AMITRIPTYLINE 25MG','Amitriptyline','TCA Antidepressant','0-0-1',90,'after_food'),
('Psychiatrist',33,'AMITRIPTYLINE 75MG','Amitriptyline','TCA Antidepressant','0-0-1',90,'after_food'),
('Psychiatrist',34,'IMIPRAMINE 25MG','Imipramine','TCA Antidepressant/Enuresis','0-0-1',90,'after_food'),
('Psychiatrist',35,'CLOMIPRAMINE 25MG','Clomipramine','TCA OCD/Anxiety/Depression','0-0-1',90,'after_food'),
('Psychiatrist',36,'CLOMIPRAMINE 50MG','Clomipramine','TCA OCD High Dose','0-0-1',90,'after_food'),
('Psychiatrist',37,'NORTRIPTYLINE 10MG','Nortriptyline','TCA Antidepressant/Neuropathic','0-0-1',90,'after_food'),
('Psychiatrist',38,'MOCLOBEMIDE 150MG','Moclobemide','Reversible MAO-A Inhibitor Antidepressant','1-0-1',90,'after_food'),
('Psychiatrist',39,'HALOPERIDOL 0.5MG','Haloperidol','Typical Antipsychotic','1-0-0',30,'after_food'),
('Psychiatrist',40,'HALOPERIDOL 1.5MG','Haloperidol','Typical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',41,'HALOPERIDOL 5MG','Haloperidol','Typical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',42,'HALOPERIDOL 10MG INJ','Haloperidol','Typical Antipsychotic Injectable Acute','sos',0,'after_food'),
('Psychiatrist',43,'TRIFLUOPERAZINE 1MG','Trifluoperazine','Typical Antipsychotic Low Dose','1-0-1',30,'after_food'),
('Psychiatrist',44,'CHLORPROMAZINE 25MG','Chlorpromazine','Typical Antipsychotic/Antiemetic','1-0-1',30,'after_food'),
('Psychiatrist',45,'CHLORPROMAZINE 50MG','Chlorpromazine','Typical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',46,'PENFLURIDOL 20MG','Penfluridol','Long-Acting Typical Antipsychotic Weekly','1-0-0',7,'after_food'),
('Psychiatrist',47,'RISPERIDONE 0.5MG','Risperidone','Atypical Antipsychotic','1-0-0',30,'after_food'),
('Psychiatrist',48,'RISPERIDONE 1MG','Risperidone','Atypical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',49,'RISPERIDONE 2MG','Risperidone','Atypical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',50,'RISPERIDONE 3MG','Risperidone','Atypical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',51,'RISPERIDONE 4MG','Risperidone','Atypical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',52,'OLANZAPINE 2.5MG','Olanzapine','Atypical Antipsychotic','0-0-1',30,'after_food'),
('Psychiatrist',53,'OLANZAPINE 5MG','Olanzapine','Atypical Antipsychotic','0-0-1',30,'after_food'),
('Psychiatrist',54,'OLANZAPINE 10MG','Olanzapine','Atypical Antipsychotic','0-0-1',30,'after_food'),
('Psychiatrist',55,'QUETIAPINE 25MG','Quetiapine','Atypical Antipsychotic/Bipolar','0-0-1',30,'after_food'),
('Psychiatrist',56,'QUETIAPINE 100MG','Quetiapine','Atypical Antipsychotic','0-0-1',30,'after_food'),
('Psychiatrist',57,'QUETIAPINE 200MG','Quetiapine','Atypical Antipsychotic','0-0-1',30,'after_food'),
('Psychiatrist',58,'QUETIAPINE XR 50MG','Quetiapine XR','Atypical Antipsychotic XR','0-0-1',30,'after_food'),
('Psychiatrist',59,'QUETIAPINE XR 150MG','Quetiapine XR','Atypical Antipsychotic XR','0-0-1',30,'after_food'),
('Psychiatrist',60,'ARIPIPRAZOLE 5MG','Aripiprazole','Atypical Antipsychotic Partial Agonist','1-0-0',30,'after_food'),
('Psychiatrist',61,'ARIPIPRAZOLE 10MG','Aripiprazole','Atypical Antipsychotic Partial Agonist','1-0-0',30,'after_food'),
('Psychiatrist',62,'ARIPIPRAZOLE 15MG','Aripiprazole','Atypical Antipsychotic Partial Agonist','1-0-0',30,'after_food'),
('Psychiatrist',63,'CLOZAPINE 25MG','Clozapine','Atypical Antipsychotic Refractory Schizophrenia','1-0-0',30,'after_food'),
('Psychiatrist',64,'CLOZAPINE 100MG','Clozapine','Atypical Antipsychotic Refractory Schizophrenia','1-0-1',30,'after_food'),
('Psychiatrist',65,'ZIPRASIDONE 20MG','Ziprasidone','Atypical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',66,'ZIPRASIDONE 40MG','Ziprasidone','Atypical Antipsychotic','1-0-1',30,'after_food'),
('Psychiatrist',67,'AMISULPRIDE 50MG','Amisulpride','Atypical Antipsychotic Low Dose Dysthymia','1-0-0',90,'after_food'),
('Psychiatrist',68,'AMISULPRIDE 200MG','Amisulpride','Atypical Antipsychotic Schizophrenia','1-0-1',30,'after_food'),
('Psychiatrist',69,'AMISULPRIDE 400MG','Amisulpride','Atypical Antipsychotic Schizophrenia','1-0-1',30,'after_food'),
('Psychiatrist',70,'PALIPERIDONE 3MG ER','Paliperidone ER','Atypical Antipsychotic ER','1-0-0',30,'after_food'),
('Psychiatrist',71,'PALIPERIDONE 6MG ER','Paliperidone ER','Atypical Antipsychotic ER','1-0-0',30,'after_food'),
('Psychiatrist',72,'LURASIDONE 40MG','Lurasidone','Atypical Antipsychotic Bipolar Depression','1-0-0',30,'after_food'),
('Psychiatrist',73,'CARIPRAZINE 1.5MG','Cariprazine','Atypical Antipsychotic Bipolar','1-0-0',30,'after_food'),
('Psychiatrist',74,'LITHIUM CARBONATE 150MG','Lithium Carbonate','Mood Stabilizer','1-0-1',90,'after_food'),
('Psychiatrist',75,'LITHIUM CARBONATE 300MG','Lithium Carbonate','Mood Stabilizer','1-0-1',90,'after_food'),
('Psychiatrist',76,'LITHIUM CARBONATE 400MG','Lithium Carbonate','Mood Stabilizer','1-0-1',90,'after_food'),
('Psychiatrist',77,'SODIUM VALPROATE 200MG','Sodium Valproate','Mood Stabilizer/Anticonvulsant','1-0-1',90,'after_food'),
('Psychiatrist',78,'SODIUM VALPROATE 500MG CR','Sodium Valproate CR','Mood Stabilizer Bipolar','1-0-1',90,'after_food'),
('Psychiatrist',79,'DIVALPROEX 250MG','Divalproex Sodium','Mood Stabilizer Bipolar/Migraine','1-0-1',90,'after_food'),
('Psychiatrist',80,'DIVALPROEX 500MG','Divalproex Sodium','Mood Stabilizer Bipolar','1-0-1',90,'after_food'),
('Psychiatrist',81,'LAMOTRIGINE 25MG','Lamotrigine','Mood Stabilizer Bipolar Depression','1-0-0',90,'after_food'),
('Psychiatrist',82,'LAMOTRIGINE 100MG','Lamotrigine','Mood Stabilizer Bipolar','1-0-0',90,'after_food'),
('Psychiatrist',83,'CARBAMAZEPINE 200MG','Carbamazepine','Mood Stabilizer/Anticonvulsant','1-0-1',90,'after_food'),
('Psychiatrist',84,'DIAZEPAM 2MG','Diazepam','Benzodiazepine Anxiolytic Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',85,'DIAZEPAM 5MG','Diazepam','Benzodiazepine Anxiolytic Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',86,'LORAZEPAM 0.5MG','Lorazepam','Benzodiazepine Short-Acting Anxiolytic Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',87,'LORAZEPAM 1MG','Lorazepam','Benzodiazepine Anxiolytic/Acute Agitation Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',88,'LORAZEPAM 4MG INJ','Lorazepam','Benzodiazepine Injectable Acute Schedule H1','sos',0,'after_food'),
('Psychiatrist',89,'CLONAZEPAM 0.25MG','Clonazepam','Benzodiazepine Anxiety/Panic Schedule H1','0-0-1',30,'after_food'),
('Psychiatrist',90,'CLONAZEPAM 0.5MG','Clonazepam','Benzodiazepine Anxiety/Panic Schedule H1','0-0-1',30,'after_food'),
('Psychiatrist',91,'ALPRAZOLAM 0.25MG','Alprazolam','Benzodiazepine Anxiety Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',92,'ALPRAZOLAM 0.5MG','Alprazolam','Benzodiazepine Anxiety Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',93,'BUSPIRONE 5MG','Buspirone','Non-Benzodiazepine Anxiolytic 5HT1A','1-0-1',30,'after_food'),
('Psychiatrist',94,'BUSPIRONE 10MG','Buspirone','Non-Benzodiazepine Anxiolytic','1-0-1',30,'after_food'),
('Psychiatrist',95,'HYDROXYZINE 10MG','Hydroxyzine','Antihistamine Anxiolytic Non-Addictive','0-0-1',7,'after_food'),
('Psychiatrist',96,'HYDROXYZINE 25MG','Hydroxyzine','Antihistamine Anxiolytic Sedative','0-0-1',7,'after_food'),
('Psychiatrist',97,'PREGABALIN 75MG','Pregabalin','Anticonvulsant/GAD Anxiety','0-0-1',30,'after_food'),
('Psychiatrist',98,'PREGABALIN 150MG','Pregabalin','Anticonvulsant/GAD Anxiety','1-0-1',30,'after_food'),
('Psychiatrist',99,'ZOLPIDEM 5MG','Zolpidem','Non-Benzodiazepine Hypnotic Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',100,'ZOLPIDEM 10MG','Zolpidem','Non-Benzodiazepine Hypnotic Schedule H1','0-0-1',7,'before_food'),
('Psychiatrist',101,'MELATONIN 3MG','Melatonin','Sleep Regulator Non-Addictive','0-0-1',14,'before_food'),
('Psychiatrist',102,'MELATONIN 5MG','Melatonin','Sleep Regulator','0-0-1',30,'before_food'),
('Psychiatrist',103,'QUETIAPINE 25MG (SLEEP)','Quetiapine','Low-Dose Atypical Antipsychotic Insomnia Off-Label','0-0-1',30,'after_food'),
('Psychiatrist',104,'MIRTAZAPINE 7.5MG (SLEEP)','Mirtazapine','Low-Dose NaSSA Insomnia/Depression','0-0-1',30,'after_food'),
('Psychiatrist',105,'TRIHEXYPHENIDYL 2MG','Trihexyphenidyl','Anticholinergic EPS Management','1-0-1',30,'after_food'),
('Psychiatrist',106,'BIPERIDEN 2MG','Biperiden','Anticholinergic EPS Management','1-0-1',30,'after_food'),
('Psychiatrist',107,'PROPRANOLOL 10MG','Propranolol','Beta Blocker Akathisia Management','1-1-1',30,'after_food'),
('Psychiatrist',108,'PROMETHAZINE 25MG','Promethazine','Antihistamine EPS/Sedation Augmentation','0-0-1',7,'after_food'),
('Psychiatrist',109,'ATOMOXETINE 10MG','Atomoxetine','SNRI ADHD Non-Stimulant','1-0-0',30,'after_food'),
('Psychiatrist',110,'ATOMOXETINE 18MG','Atomoxetine','SNRI ADHD Non-Stimulant Pediatric','1-0-0',30,'after_food'),
('Psychiatrist',111,'ATOMOXETINE 25MG','Atomoxetine','SNRI ADHD Non-Stimulant','1-0-0',30,'after_food'),
('Psychiatrist',112,'ATOMOXETINE 40MG','Atomoxetine','SNRI ADHD Non-Stimulant','1-0-0',30,'after_food'),
('Psychiatrist',113,'DONEPEZIL 5MG','Donepezil','ChEI Dementia/Cognitive Impairment','0-0-1',90,'after_food'),
('Psychiatrist',114,'MEMANTINE 10MG','Memantine','NMDA Antagonist Dementia','1-0-0',90,'after_food'),
('Psychiatrist',115,'HALOPERIDOL DECANOATE 50MG INJ','Haloperidol Decanoate','Long-Acting Injectable Antipsychotic Monthly','sos',0,'after_food'),
('Psychiatrist',116,'FLUPHENAZINE DECANOATE 25MG INJ','Fluphenazine Decanoate','Long-Acting Injectable Antipsychotic','sos',0,'after_food'),
('Psychiatrist',117,'RISPERIDONE CONSTA 25MG INJ','Risperidone Microspheres','Long-Acting Injectable Atypical Antipsychotic Biweekly','sos',0,'after_food'),
('Psychiatrist',118,'PALIPERIDONE PALMITATE 75MG INJ','Paliperidone Palmitate','Long-Acting Injectable Atypical Monthly','sos',0,'after_food'),
('Psychiatrist',119,'ARIPIPRAZOLE MONOHYDRATE 400MG INJ','Aripiprazole Monohydrate','Long-Acting Injectable Atypical Monthly','sos',0,'after_food'),
('Psychiatrist',120,'PANTOPRAZOLE 40MG','Pantoprazole','PPI GI Protection with Antipsychotics','1-0-0',30,'before_food'),
('Psychiatrist',121,'METFORMIN 500MG','Metformin','Antidiabetic Metabolic Side Effect Management','1-1-1',90,'after_food'),
('Psychiatrist',122,'ATORVASTATIN 10MG','Atorvastatin','Statin Metabolic Side Effect Management','0-0-1',90,'after_food'),
('Psychiatrist',123,'VITAMIN D3 60000IU','Cholecalciferol','Vitamin D Weekly Supplement','1-0-0',28,'after_food'),
('Psychiatrist',124,'FOLIC ACID 5MG','Folic Acid','B Vitamin (with Mood Stabilizers)','1-0-0',90,'after_food'),
('Psychiatrist',125,'OMEGA-3 FATTY ACIDS 2GM','Omega-3 EPA/DHA','Anti-Inflammatory Antidepressant Adjunct','1-0-1',90,'after_food'),
('Psychiatrist',126,'MECOBALAMIN 1500MCG','Methylcobalamin','Vitamin B12 Neuroprotective','1-0-0',30,'after_food'),
('Psychiatrist',127,'N-ACETYLCYSTEINE 600MG','N-Acetylcysteine','Antioxidant Glutamate Modulator OCD/SUD','1-0-1',90,'after_food'),
('Psychiatrist',128,'INOSITOL 2GM','Inositol','Second Messenger Supplement OCD/Panic','1-0-1',90,'after_food'),
('Psychiatrist',129,'BACLOFEN 10MG','Baclofen','GABA-B Agonist Alcohol Use Disorder','1-0-1',30,'after_food'),
('Psychiatrist',130,'NALTREXONE 25MG','Naltrexone','Opioid Antagonist Alcohol Use Disorder','1-0-0',30,'after_food'),
('Psychiatrist',131,'NALTREXONE 50MG','Naltrexone','Opioid Antagonist Alcohol Use Disorder','1-0-0',30,'after_food'),
('Psychiatrist',132,'ACAMPROSATE 333MG','Acamprosate','Anti-Craving Alcohol Abstinence','1-1-1',0,'after_food'),
('Psychiatrist',133,'DISULFIRAM 250MG','Disulfiram','Aldehyde Dehydrogenase Inhibitor Alcohol Aversion','1-0-0',0,'after_food'),
('Psychiatrist',134,'VARENICLINE 0.5MG','Varenicline','Nicotinic Agonist Smoking Cessation','1-0-0',7,'after_food'),
('Psychiatrist',135,'VARENICLINE 1MG','Varenicline','Nicotinic Agonist Smoking Cessation','1-0-1',84,'after_food'),
('Psychiatrist',136,'ESCITALOPRAM 10MG + CLONAZEPAM 0.5MG','Escitalopram + Clonazepam','SSRI + Benzodiazepine Combination Anxiety','1-0-0',30,'after_food'),
('Psychiatrist',137,'SERTRALINE 50MG + CLONAZEPAM 0.25MG','Sertraline + Clonazepam','SSRI + Benzodiazepine Combination','1-0-0',30,'after_food'),
('Psychiatrist',138,'TRIFLUOPERAZINE 5MG + CHLORDIAZEPOXIDE 10MG','Trifluoperazine + Chlordiazepoxide','Typical Antipsychotic + Anxiolytic Combination','1-0-1',30,'after_food'),
('Psychiatrist',139,'FLUPENTHIXOL 0.5MG + MELITRACEN 10MG','Flupenthixol + Melitracen','Thioxanthene + TCA Combination Anxiety/Depression','1-0-0',30,'after_food'),
('Psychiatrist',140,'DIAZEPAM 10MG INJ','Diazepam','Benzodiazepine IV Acute Agitation Schedule H1','sos',0,'after_food'),
('Psychiatrist',141,'OLANZAPINE 10MG INJ','Olanzapine','Atypical Antipsychotic IM Acute Agitation','sos',0,'after_food'),
('Psychiatrist',142,'HALOPERIDOL 5MG INJ + PROMETHAZINE 25MG INJ','Haloperidol + Promethazine','Rapid Tranquilization Injectable Combination','sos',0,'after_food'),
('Psychiatrist',143,'SODIUM VALPROATE 400MG/4ML INJ','Sodium Valproate','Anticonvulsant IV Acute Mania','sos',0,'after_food'),
('Psychiatrist',144,'CARBAMAZEPINE 200MG CR','Carbamazepine CR','Mood Stabilizer Controlled Release','1-0-1',90,'after_food'),
('Psychiatrist',145,'TOPIRAMATE 50MG','Topiramate','Anticonvulsant Weight Gain/Mood Adjunct','0-0-1',90,'after_food'),
('Psychiatrist',146,'GABAPENTIN 300MG','Gabapentin','Anticonvulsant Anxiety/Insomnia Adjunct','0-0-1',30,'after_food'),
('Psychiatrist',147,'LORAZEPAM 1MG SUBLINGUAL','Lorazepam','Benzodiazepine Sublingual Acute Anxiety Schedule H1','sos',0,'sublingual'),
('Psychiatrist',148,'RISPERIDONE 0.5MG ORAL SOLUTION 1MG/ML','Risperidone Oral Solution','Atypical Antipsychotic Liquid','1-0-1',30,'after_food'),
('Psychiatrist',149,'ARIPIPRAZOLE 400MG INJ','Aripiprazole Monohydrate','Long-Acting Injectable Monthly Schizophrenia','sos',0,'after_food'),
('Psychiatrist',150,'BREXPIPRAZOLE 1MG','Brexpiprazole','Atypical Antipsychotic MDD Adjunct','1-0-0',90,'after_food');

-- ═══════════════════════════════════════════════════════════
-- PART G: DENTIST (150 rows)
-- ═══════════════════════════════════════════════════════════
INSERT INTO specialty_starter_packs(specialty, rank, drug_name, generic_name, category, default_dosage, default_duration, default_timing) VALUES
('Dentist',1,'PARACETAMOL 500MG','Paracetamol','Analgesic/Antipyretic','1-1-1',5,'after_food'),
('Dentist',2,'PARACETAMOL 650MG','Paracetamol','Analgesic/Antipyretic','1-1-1',5,'after_food'),
('Dentist',3,'IBUPROFEN 400MG','Ibuprofen','NSAID Dental Pain','1-1-1',5,'after_food'),
('Dentist',4,'IBUPROFEN 600MG','Ibuprofen','NSAID Dental Pain High Dose','1-0-1',5,'after_food'),
('Dentist',5,'DICLOFENAC 50MG','Diclofenac','NSAID','1-0-1',5,'after_food'),
('Dentist',6,'ACECLOFENAC 100MG','Aceclofenac','NSAID','1-0-1',5,'after_food'),
('Dentist',7,'KETOROLAC 10MG','Ketorolac','NSAID/Analgesic Dental Pain','1-1-1',3,'after_food'),
('Dentist',8,'NIMESULIDE 100MG','Nimesulide','NSAID Dental Pain','1-0-1',3,'after_food'),
('Dentist',9,'TRAMADOL 50MG','Tramadol','Opioid Analgesic Post-Surgical','1-1-1',3,'after_food'),
('Dentist',10,'PARACETAMOL + TRAMADOL','Paracetamol + Tramadol','Analgesic Combination Post-Extraction','1-0-1',3,'after_food'),
('Dentist',11,'AMOXICILLIN 250MG','Amoxicillin','Penicillin Antibiotic','1-1-1',7,'before_food'),
('Dentist',12,'AMOXICILLIN 500MG','Amoxicillin','Penicillin Antibiotic','1-1-1',7,'before_food'),
('Dentist',13,'AMOXICLAV 375MG','Amoxicillin + Clavulanate','Beta-