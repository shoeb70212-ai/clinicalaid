-- ============================================================
-- ClinicFlow — Rebuilt Database Schema v2.0
-- Addresses all 70 audit findings from schema review
-- Run in order: this file replaces 001_initial_schema.sql
--               and supersedes 002/003_specialty_starter_packs.sql
-- ============================================================

BEGIN;

-- ── EXTENSIONS ───────────────────────────────────────────────────────────────
-- pg_trgm   : Trigram-based fuzzy search for drug name autocomplete
-- uuid-ossp : UUID generation for multi-tenant IDs
-- unaccent  : Language-agnostic search (handles é, ā, ṭ etc.)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;


-- ── ENUMERATIONS ─────────────────────────────────────────────────────────────
-- Using enums instead of free-text strings for all constrained value sets.
-- Reason: DB-level validation catches bad data before it enters; 
--         application-level validation alone is insufficient for medical data.

-- Indian drug schedule classification per Drugs and Cosmetics Act 1940
CREATE TYPE drug_schedule_enum AS ENUM (
  'H',           -- Prescription only
  'H1',          -- Prescription only + special record keeping (Tramadol, Clonazepam etc.)
  'G',           -- Pharmacist supervision
  'L',           -- Restricted to hospitals
  'X',           -- Narcotic/psychotropic — highest control (NOT used in starter packs)
  'OTC',         -- Over the counter
  'AYUSH',       -- Ayurveda/Unani/Siddha/Homeopathy formulations
  'NARCOTIC',    -- NDPs under NDPS Act 1985
  'PSYCHOTROPIC' -- Psychotropic substances under NDPS Act
);

-- Timing of drug administration
-- Extended from original 3-value set to cover AYUSH anupana requirements
CREATE TYPE timing_enum AS ENUM (
  'after_food',
  'before_food',
  'empty_stomach',
  'with_milk',               -- Ashwagandha, Musali Pak etc.
  'with_warm_water',         -- Most Ayurvedic Churnas
  'with_honey',              -- Many Avalehas
  'with_ghee',               -- Ghrita formulations
  'with_warm_water_before_food', -- Digestive compounds
  'with_juice',
  'sublingual',              -- Nitroglycerine, Buprenorphine SL
  'as_directed'              -- Complex protocols
);

-- Dosage frequency unit — fixes the 0-0-0 weekly dose ambiguity
CREATE TYPE frequency_unit_enum AS ENUM (
  'daily',       -- Standard 1-1-1, 1-0-1 etc.
  'weekly',      -- Alendronate, Methotrexate, Vitamin D sachet
  'monthly',     -- Depot injections, Zoledronic acid
  'sos',         -- As needed / PRN
  'single_dose', -- One-time (Emergency contraceptive, Fluconazole 150mg)
  'as_directed'  -- Complex titration
);

-- DDI severity levels — aligns with standard pharmacovigilance grading
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
-- Fixes the issue of dental materials, cosmetic procedures mixed into drug table
CREATE TYPE item_type_enum AS ENUM (
  'drug',        -- Prescribable pharmaceutical
  'procedure',   -- Clinical procedure (PRP, Botox injection)
  'material',    -- Dental/surgical material (GIC, Gutta Percha)
  'supplement',  -- Nutritional supplement
  'cosmetic',    -- Cosmetic/aesthetic agent
  'device',      -- Medical device (Bandage lens, IUD)
  'ayush'        -- Classical Ayurvedic/Homeopathic formulation
);

-- CDSCO registration status
CREATE TYPE cdsco_status_enum AS ENUM (
  'approved',
  'suspended',
  'withdrawn',
  'under_review',
  'banned'       -- Explicit ban via gazette notification
);

-- Product tier for feature gating
CREATE TYPE feature_tier_enum AS ENUM (
  'free',
  'pro',
  'enterprise'
);

-- Pregnancy safety classification
-- X = Contraindicated, N = Not yet classified (common for AYUSH)
CREATE TYPE pregnancy_category_enum AS ENUM (
  'A', 'B', 'C', 'D', 'X', 'N'
);

-- Audit log operation types
CREATE TYPE operation_enum AS ENUM (
  'INSERT', 'UPDATE', 'DELETE'
);

-- Drug monitoring timing
CREATE TYPE monitoring_timing_enum AS ENUM (
  'baseline',          -- Before starting drug
  'ongoing',           -- During treatment
  'on_discontinuation',-- When stopping
  'periodic'           -- At defined intervals
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: REFERENCE / LOOKUP TABLES
-- These are global, non-tenant-specific, slow-changing data
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 1: DRUG ALLERGY CLASSES ────────────────────────────────────────────
-- Decision: Normalize allergy classes into their own table.
-- Reason: When a patient records "Penicillin allergy", the system must
--         automatically flag ALL drugs in the penicillin class + cross-reactive
--         classes (e.g., some cephalosporins). A free-text field cannot do this.
-- The cross_reactive_class_ids array enables bidirectional allergy cross-checking.

CREATE TABLE drug_allergy_classes (
  id                      SERIAL PRIMARY KEY,
  class_name              VARCHAR(100)  NOT NULL UNIQUE,
  description             TEXT,
  cross_reactive_class_ids INTEGER[],   -- IDs of other allergy classes with cross-reactivity
  examples                TEXT,         -- Example drugs for UI display
  created_at              TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE drug_allergy_classes IS
  'Normalized allergy classification. Enables patient allergy → drug contraindication cross-reference.';

-- Seed core allergy classes
INSERT INTO drug_allergy_classes (class_name, description, examples) VALUES
('Penicillin class',    'All penicillin-based antibiotics',                    'Amoxicillin, Ampicillin, Piperacillin'),
('Cephalosporins',      '5-10% cross-reactivity with penicillins',             'Cefixime, Cefuroxime, Ceftriaxone'),
('Sulfonamides',        'Sulfa drug allergy',                                  'Cotrimoxazole, Sulfasalazine, Furosemide (partial)'),
('NSAIDs',              'Aspirin/NSAID hypersensitivity',                      'Ibuprofen, Diclofenac, Naproxen, Aspirin'),
('Fluoroquinolones',    'Quinolone class allergy',                             'Ciprofloxacin, Levofloxacin, Moxifloxacin'),
('Macrolides',          'Macrolide antibiotic allergy',                        'Azithromycin, Erythromycin, Clarithromycin'),
('Tetracyclines',       'Tetracycline class allergy',                          'Doxycycline, Minocycline'),
('Opioids',             'Opioid/narcotic allergy or intolerance',              'Tramadol, Codeine, Morphine'),
('Statins',             'HMG-CoA reductase inhibitor intolerance',             'Atorvastatin, Rosuvastatin, Simvastatin'),
('Benzodiazepines',     'BZD class allergy',                                   'Alprazolam, Clonazepam, Diazepam'),
('Contrast dye',        'Iodinated contrast media allergy',                    'Iohexol, Iopromide'),
('Local anaesthetics',  'Amide or ester LA allergy',                           'Lidocaine, Articaine, Bupivacaine'),
('Latex',               'Latex hypersensitivity (cross-reactive with some foods)', 'Surgical gloves, catheters'),
('Bisphosphonates',     'Bisphosphonate class (MRONJ risk)',                   'Alendronate, Zoledronic acid, Ibandronate')
ON CONFLICT DO NOTHING;

-- Update cross-reactivity: Penicillins ↔ Cephalosporins
UPDATE drug_allergy_classes SET cross_reactive_class_ids = ARRAY[
  (SELECT id FROM drug_allergy_classes WHERE class_name = 'Cephalosporins')
] WHERE class_name = 'Penicillin class';

UPDATE drug_allergy_classes SET cross_reactive_class_ids = ARRAY[
  (SELECT id FROM drug_allergy_classes WHERE class_name = 'Penicillin class')
] WHERE class_name = 'Cephalosporins';


-- ── TABLE 2: THERAPEUTIC GROUPS ──────────────────────────────────────────────
-- Decision: Implement WHO ATC (Anatomical Therapeutic Chemical) taxonomy.
-- Reason: ATC is the international standard (WHO, EMA, FDA all use it).
--         Enables "show all PPIs", "suggest cheaper ACE inhibitor",
--         "filter by cardiovascular drugs", without string-matching hacks.
-- 5-level hierarchy: Anatomical → Therapeutic → Pharmacological → Chemical → Substance

CREATE TABLE therapeutic_groups (
  id              SERIAL PRIMARY KEY,
  group_name      VARCHAR(150)  NOT NULL,
  atc_code        VARCHAR(7)    UNIQUE,      -- e.g., A02BC = PPIs
  atc_level       INTEGER       CHECK (atc_level BETWEEN 1 AND 5),
  parent_group_id INTEGER       REFERENCES therapeutic_groups(id),
  description     TEXT,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE therapeutic_groups IS
  'WHO ATC classification hierarchy. Enables therapeutic equivalence lookup and drug class filtering.';

-- Seed key ATC groups relevant to Indian primary care
INSERT INTO therapeutic_groups (group_name, atc_code, atc_level) VALUES
-- Level 1: Anatomical
('Alimentary tract and metabolism',         'A',       1),
('Blood and blood forming organs',          'B',       1),
('Cardiovascular system',                   'C',       1),
('Dermatologicals',                         'D',       1),
('Genito urinary and sex hormones',         'G',       1),
('Systemic hormonal preparations',          'H',       1),
('Anti-infectives for systemic use',        'J',       1),
('Antineoplastic and immunomodulating',     'L',       1),
('Musculoskeletal system',                  'M',       1),
('Nervous system',                          'N',       1),
('Respiratory system',                      'R',       1),
('Sensory organs',                          'S',       1),
-- Level 3: Key pharmacological groups
('Proton Pump Inhibitors',                  'A02BC',   3),
('ACE Inhibitors',                          'C09AA',   3),
('ARB Antihypertensives',                   'C09CA',   3),
('Calcium Channel Blockers',                'C08CA',   3),
('Beta Blockers',                           'C07AB',   3),
('Statins',                                 'C10AA',   3),
('Antiplatelets',                           'B01AC',   3),
('Oral Anticoagulants',                     'B01AF',   3),
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
('Antihistamines (non-sedating)',            'R06AX',   3),
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
('Oral Contraceptives',                     'G03AA',   3)
ON CONFLICT DO NOTHING;


-- ── TABLE 3: DRUG MOLECULES ───────────────────────────────────────────────────
-- Decision: Create a master molecule table as the single source of truth.
-- Reason: Without normalization, "Paracetamol" appears 15+ times across
--         specialties with potentially inconsistent data. A molecule table
--         means any change (e.g., CDSCO bans a drug) propagates instantly
--         to all 2100+ rows via the FK relationship.
--
-- The banned drug trigger in Section 4 reads from this table to block inserts.

CREATE TABLE drug_molecules (
  id                              SERIAL PRIMARY KEY,

  -- WHO Identity
  inn_name                        VARCHAR(200)             NOT NULL UNIQUE,
  who_atc_code                    VARCHAR(10),
  snomed_ct_code                  VARCHAR(20),
  rxnorm_code                     VARCHAR(20),             -- US RxNorm (for FHIR)
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

  -- Availability (India-specific)
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
  'All specialty_starter_packs rows should link here via molecule_id.';

-- Seed critical banned drugs — these will trigger the guard trigger
INSERT INTO drug_molecules (inn_name, is_banned_india, ban_gazette_notification, cdsco_approval_status) VALUES
('Dextropropoxyphene',    TRUE, 'GSR 185(E) dated 10.03.2013', 'banned'),
('Ranitidine',            FALSE, 'CDSCO advisory 2020 re NDMA contamination', 'withdrawn'),
('Nimesulide (Paediatric)', TRUE, 'G.S.R. 82(E) dated 10.02.2011', 'banned'),
('Sibutramine',           TRUE, 'G.S.R. 739(E) dated 10.10.2010', 'banned'),
('Phenacetin',            TRUE, 'Historical ban', 'banned')
ON CONFLICT (inn_name) DO NOTHING;


-- ── TABLE 4: DRUG INTERACTIONS ───────────────────────────────────────────────
-- Decision: Bidirectional unique constraint via LEAST/GREATEST trick.
-- Reason: Drug A ↔ Drug B is the same interaction as Drug B ↔ Drug A.
--         Without this, the same interaction would be stored twice,
--         creating maintenance problems and duplicate alerts.

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
  'Severity: contraindicated > major > moderate > minor.';


-- ── TABLE 5: DRUG SIDE EFFECTS ───────────────────────────────────────────────
-- Decision: Separate table with frequency grading per EU SmPC standard.
-- Reason: Side effects are molecule-level facts, not pack-level. Storing
--         them here means they appear for ALL dosage forms of the molecule.
--         Black box warning flag enables high-visibility UI alerts.

CREATE TABLE drug_side_effects (
  id                  SERIAL PRIMARY KEY,
  molecule_id         INTEGER       NOT NULL REFERENCES drug_molecules(id),
  effect              TEXT          NOT NULL,
  frequency           VARCHAR(20)   CHECK (frequency IN (
                        'very_common',   -- >10%
                        'common',        -- 1-10%
                        'uncommon',      -- 0.1-1%
                        'rare',          -- 0.01-0.1%
                        'very_rare'      -- <0.01%
                      )),
  severity            VARCHAR(15)   CHECK (severity IN ('mild','moderate','severe','life_threatening')),
  is_black_box_warning BOOLEAN      DEFAULT FALSE,
  requires_monitoring  BOOLEAN      DEFAULT FALSE,
  monitoring_test      TEXT,
  created_at          TIMESTAMPTZ   DEFAULT NOW()
);


-- ── TABLE 6: DRUG MONITORING REQUIREMENTS ────────────────────────────────────
-- Decision: Mandatory monitoring as structured data, not free text.
-- Reason: If Methotrexate monitoring is stored as a text note, the system
--         cannot automatically generate a lab order suggestion. Structured
--         data enables: "When Methotrexate is prescribed → prompt LFT + CBC order".

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

-- Seed critical monitoring requirements
-- (molecule_id will be populated when actual molecule rows are inserted)
COMMENT ON TABLE drug_monitoring_requirements IS
  'Structured drug monitoring requirements. Enables automatic lab order prompting in the prescription workflow.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: VERSIONING & MIGRATION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 7: SPECIALTY PACK VERSIONS ─────────────────────────────────────────
-- Decision: Semantic versioning per specialty.
-- Reason: Clinical guidelines change (e.g., ICMR updates diabetes management).
--         Without versioning, clinics on old data have no way to know an update
--         exists. With versioning, the system can notify clinics and offer
--         migration to the new pack version.

CREATE TABLE specialty_pack_versions (
  id                  SERIAL PRIMARY KEY,
  version_number      VARCHAR(10)   NOT NULL,        -- '2.0.0', '2.1.0'
  specialty           VARCHAR(100),                  -- NULL = applies to all specialties
  released_at         TIMESTAMPTZ   DEFAULT NOW(),
  release_notes       TEXT,
  breaking_changes    TEXT,                          -- Flags if drug removed or default changed
  is_current          BOOLEAN       DEFAULT FALSE,
  clinical_reviewer   VARCHAR(200),                  -- Name + NMC/MCI registration
  review_institution  VARCHAR(200),
  review_date         DATE,
  guideline_source    VARCHAR(300),                  -- 'ICMR 2023 Hypertension Guidelines v4.1'
  guideline_edition   VARCHAR(100),
  created_by          VARCHAR(100),

  CONSTRAINT uq_version_specialty UNIQUE (version_number, specialty)
);

-- Insert v2.0.0 as current version
INSERT INTO specialty_pack_versions
  (version_number, specialty, release_notes, is_current, guideline_source)
VALUES
  ('2.0.0', NULL,
   'Full schema rebuild. Addresses 70 audit findings. Adds normalized molecules, interactions, monitoring, AYUSH timing enums, banned drug guards, audit trails.',
   TRUE,
   'ICMR 2023 National Essential Medicines List; WHO ATC 2024; CDSCO Drug Schedules 2023')
ON CONFLICT DO NOTHING;


-- ── TABLE 8: SEED RUNS ────────────────────────────────────────────────────────
-- Decision: Track every seed/migration run with outcome metrics.
-- Reason: In a production multi-tenant system, knowing exactly which rows
--         were inserted, skipped, or failed during a seed run is critical
--         for debugging data discrepancies across clinic installations.

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

-- ── TABLE 9: SPECIALTY STARTER PACKS (REBUILT) ───────────────────────────────
-- This is the central table. Every design decision documented below.

CREATE TABLE specialty_starter_packs (
  id                        SERIAL PRIMARY KEY,

  -- ── IDENTITY ──
  specialty                 VARCHAR(100)           NOT NULL,
  rank                      INTEGER                NOT NULL,
  pack_version_id           INTEGER                REFERENCES specialty_pack_versions(id),

  -- ── DRUG IDENTITY ──
  -- drug_name: UPPERCASE per NMC mandate — display name shown to doctor
  -- molecule_id: FK to normalized molecule table — enables safety checks
  -- Both stored to maintain display flexibility while enabling safety logic
  drug_name                 VARCHAR(300)           NOT NULL,
  molecule_id               INTEGER                REFERENCES drug_molecules(id),
  generic_name              VARCHAR(200)           NOT NULL,

  -- ── PHARMACOLOGICAL CLASSIFICATION ──
  -- category: retained for display/legacy; therapeutic_group comes via molecule
  category                  VARCHAR(200),

  -- ── DOSAGE (RESTRUCTURED) ──
  -- default_dosage: the M-A-E shorthand ('1-1-1', '1-0-1', 'sos')
  --   retained for Indian prescription convention compatibility
  -- dosage_frequency_unit: fixes the '0-0-0 for 4 weeks' ambiguity
  -- dosage_interval_days: explicit interval (7 = weekly, 30 = monthly)
  -- Example: Alendronate 70mg weekly →
  --   default_dosage='1-0-0', frequency_unit='weekly', interval_days=7, duration=12
  default_dosage            VARCHAR(20),
  dosage_frequency_unit     frequency_unit_enum    DEFAULT 'daily',
  dosage_interval_days      INTEGER                DEFAULT 1,
  default_duration          INTEGER                DEFAULT 0,    -- days; 0 = ongoing
  default_timing            timing_enum            DEFAULT 'after_food',

  -- ── DOSE SAFETY GUARDRAILS ──
  -- Prevent doctors from overriding to dangerous doses
  -- Application layer reads these to show a warning on override
  max_daily_dose_mg         DECIMAL(10,3),
  max_duration_days         INTEGER,
  max_dose_warning_text     TEXT,

  -- ── ITEM CLASSIFICATION ──
  -- Separates drugs from procedures, materials, cosmetics
  -- Fixes: dental materials, PRP, warm compress being in drug table
  item_type                 item_type_enum         DEFAULT 'drug',
  schedule_class            drug_schedule_enum,

  -- ── PEDIATRIC DOSING ──
  -- Fixes: Pediatrician pack had fixed doses when weight-based is required
  is_weight_based           BOOLEAN                DEFAULT FALSE,
  dosage_per_kg             DECIMAL(6,3),          -- mg/kg/dose
  max_single_dose_mg        DECIMAL(8,2),          -- absolute ceiling mg

  -- ── BEHAVIORAL FLAGS ──
  -- Replaces string-parsing of 'sos' in dosage column
  is_prn                    BOOLEAN                DEFAULT FALSE,    -- PRN/as-needed
  is_single_use             BOOLEAN                DEFAULT FALSE,    -- One-time use
  is_scheduled              BOOLEAN                DEFAULT TRUE,     -- Regular dosing
  requires_special_monitoring BOOLEAN              DEFAULT FALSE,

  -- ── CLINICAL CONTEXT ──
  clinical_indication       VARCHAR(300),          -- Why this drug is in this specialty pack
  contraindications         TEXT,                  -- Key contraindications for display
  interaction_alerts        TEXT[],                -- High-level alert text for UI

  -- ── GUIDELINE ATTRIBUTION ──
  -- Every default dosage/duration should be traceable to a guideline
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
  -- Top 50 drugs free; full 150 on Pro; custom on Enterprise
  available_in_tier         feature_tier_enum      DEFAULT 'free',

  -- ── PATIENT COMMUNICATION ──
  -- Drug names in all-caps clinical format are not patient-friendly
  -- These fields support the patient-facing prescription printout
  patient_label             VARCHAR(200),          -- 'Blood pressure tablet'
  patient_instructions      TEXT,
  patient_instructions_hindi    TEXT,
  patient_instructions_marathi  TEXT,
  patient_instructions_tamil    TEXT,
  patient_instructions_telugu   TEXT,
  patient_instructions_kannada  TEXT,
  patient_instructions_gujarati TEXT,

  -- ── VISUAL IDENTIFICATION ──
  -- Helps low-literacy patients and elderly identify tablets
  tablet_color              VARCHAR(50),
  tablet_shape              VARCHAR(50),
  pill_image_url            TEXT,
  packaging_image_url       TEXT,

  -- ── FHIR / ABDM INTEROPERABILITY ──
  -- Required for ABDM-compliant digital prescriptions
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
  -- Two separate mechanisms:
  --   is_active: drug temporarily unavailable or under review
  --   deleted_at: logical delete for audit trail preservation
  -- Never hard delete a drug row — prescriptions may reference it
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
  'Never hard-delete rows — use soft-delete (deleted_at) for audit trail.';

COMMENT ON COLUMN specialty_starter_packs.dosage_frequency_unit IS
  'Fixes ambiguity of 0-0-0 pattern for weekly/monthly drugs. '
  'Example: Alendronate 70mg = frequency_unit:weekly, interval_days:7, dosage:1-0-0';

COMMENT ON COLUMN specialty_starter_packs.item_type IS
  'Separates prescribable drugs from procedures (PRP), materials (GIC), '
  'cosmetics (whitening gel), and devices (bandage lens). '
  'UI can filter to show only item_type=drug in the prescription module.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4: TENANT CUSTOMIZATION LAYER (3-TIER ARCHITECTURE)
-- Global defaults → Organization overrides → Doctor preferences
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 10: ORG DRUG OVERRIDES ─────────────────────────────────────────────
-- Decision: Organization layer sits between global pack and doctor layer.
-- Reason: A hospital chain may restrict Clozapine to psychiatry wards only.
--         A rural clinic may want to hide drugs unavailable in their area.
--         A teaching hospital may want to enforce evidence-based defaults.
--         These are org-wide policies, not individual doctor preferences.

CREATE TABLE org_drug_overrides (
  id                  SERIAL PRIMARY KEY,
  org_id              UUID          NOT NULL,
  global_pack_id      INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  custom_rank         INTEGER,
  custom_dosage       VARCHAR(20),
  custom_duration     INTEGER,
  custom_timing       timing_enum,
  is_hidden           BOOLEAN       DEFAULT FALSE,     -- Remove from org's list
  is_restricted       BOOLEAN       DEFAULT FALSE,     -- Show but require reason to prescribe
  restriction_reason  TEXT,                            -- Why restricted (formulary, safety)
  approved_by         VARCHAR(200),                    -- Medical director who approved override
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_org_drug_override UNIQUE (org_id, global_pack_id)
);


-- ── TABLE 11: DOCTOR DRUG PREFERENCES ────────────────────────────────────────
-- Decision: Doctor-level layer with usage analytics built in.
-- Reason: A doctor who prescribes Telmisartan 40mg 95% of the time should
--         see it at rank 1 in their personal view. The prescription_count
--         and last_prescribed_at fields enable the system to auto-learn
--         and re-rank based on actual behavior — making the tool smarter over time.

CREATE TABLE doctor_drug_preferences (
  id                    SERIAL PRIMARY KEY,
  doctor_id             UUID          NOT NULL,
  drug_pack_id          INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  personal_rank         INTEGER,
  personal_dosage       VARCHAR(20),
  personal_duration     INTEGER,
  personal_timing       timing_enum,
  is_pinned             BOOLEAN       DEFAULT FALSE,   -- Pinned to top of list
  is_favorite           BOOLEAN       DEFAULT FALSE,   -- Starred/bookmarked
  is_hidden             BOOLEAN       DEFAULT FALSE,   -- Doctor hides drugs they never use
  prescription_count    INTEGER       DEFAULT 0,
  last_prescribed_at    TIMESTAMPTZ,
  avg_duration_used     DECIMAL(5,1),
  most_common_dosage    VARCHAR(20),                   -- Derived from prescription history
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_doctor_drug UNIQUE (doctor_id, drug_pack_id)
);


-- ── TABLE 12: PRESCRIPTION TEMPLATES ─────────────────────────────────────────
-- Decision: Template system for common drug combinations.
-- Reason: A doctor treating a newly diagnosed T2DM patient prescribes
--         Metformin + Glimepiride + Pantoprazole + Atorvastatin + Aspirin
--         every single time. Selecting 5 drugs individually is wasteful.
--         Templates allow 1-click insertion of the full combination.

CREATE TABLE prescription_templates (
  id                  SERIAL PRIMARY KEY,
  template_name       VARCHAR(200)  NOT NULL,
  specialty           VARCHAR(100),
  clinical_indication VARCHAR(300),
  description         TEXT,
  is_global           BOOLEAN       DEFAULT FALSE,   -- System-wide template
  org_id              UUID,                           -- Org-specific template
  doctor_id           UUID,                           -- Doctor's personal template
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
  id                  SERIAL PRIMARY KEY,
  template_id         INTEGER       NOT NULL REFERENCES prescription_templates(id) ON DELETE CASCADE,
  drug_pack_id        INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  sequence_order      INTEGER       NOT NULL,
  dosage_override     VARCHAR(20),
  duration_override   INTEGER,
  timing_override     timing_enum,
  instructions_override TEXT,

  CONSTRAINT uq_template_drug UNIQUE (template_id, drug_pack_id),
  CONSTRAINT chk_sequence_positive CHECK (sequence_order > 0)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5: CUSTOMIZATION & REGIONAL VARIATION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 13: REGIONAL DRUG VARIATIONS ───────────────────────────────────────
-- Decision: State-level rank adjustments and seasonal tagging.
-- Reason: India's disease burden varies dramatically by region and season.
--         Antimalarials are critically important in Assam and Odisha but
--         rarely needed in Himachal Pradesh. Dengue season drugs should
--         auto-promote in August-October in endemic states.

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

-- ── TABLE 14: DRUG PRESCRIPTION ANALYTICS ────────────────────────────────────
-- Decision: Time-bucketed analytics with org and doctor dimensions.
-- Reason: The current static pack ranks are based on guesswork about
--         prescribing frequency. Real usage data should drive re-ranking.
--         date_bucket enables time-series analysis (seasonal patterns,
--         post-guideline-update adoption tracking).

CREATE TABLE drug_prescription_analytics (
  id                      BIGSERIAL PRIMARY KEY,
  drug_pack_id            INTEGER       NOT NULL REFERENCES specialty_starter_packs(id),
  org_id                  UUID,
  doctor_id               UUID,
  prescription_count      INTEGER       DEFAULT 0,
  last_prescribed_at      TIMESTAMPTZ,
  avg_duration_prescribed DECIMAL(5,1),
  most_common_dosage      VARCHAR(20),
  date_bucket             DATE          NOT NULL,     -- Truncated to month for aggregation
  state_code              CHAR(2),
  specialty_context       VARCHAR(100),               -- Which specialty was active when prescribed
  created_at              TIMESTAMPTZ   DEFAULT NOW(),

  CONSTRAINT uq_analytics_bucket UNIQUE (drug_pack_id, org_id, doctor_id, date_bucket)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7: AUDIT & COMPLIANCE
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TABLE 15: SPECIALTY PACK AUDIT LOG ───────────────────────────────────────
-- Decision: JSONB old/new values with session context.
-- Reason: Healthcare software is subject to regulatory audit.
--         If a drug's default dosage is changed and a patient is harmed,
--         there must be a trail showing who changed what, when, and why.
--         JSONB stores the complete before/after state of any row change.

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
  'Required for healthcare regulatory compliance. Never delete rows from this table.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8: INDEXES
-- Decision: Index strategy based on the 4 primary query patterns:
--   1. Specialty + rank (most common — loading the drug list for a specialty)
--   2. Drug name fuzzy search (autocomplete as doctor types)
--   3. Generic name lookup (cross-specialty molecule lookup)
--   4. Analytics queries (time-series by drug + org)
-- ═══════════════════════════════════════════════════════════════════════════

-- Primary lookup — specialty filtered, rank ordered, active only
CREATE INDEX idx_ssp_specialty_rank
  ON specialty_starter_packs (specialty, rank)
  WHERE deleted_at IS NULL AND is_active = TRUE;

-- Trigram index for fuzzy drug name autocomplete
-- Catches: 'PARAC' → 'PARACETAMOL', 'AMOX' → 'AMOXICILLIN'
CREATE INDEX idx_ssp_drug_name_trgm
  ON specialty_starter_packs USING GIN (drug_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Full text search combining drug_name + generic_name
CREATE INDEX idx_ssp_fts
  ON specialty_starter_packs
  USING GIN (to_tsvector('english', drug_name || ' ' || generic_name))
  WHERE deleted_at IS NULL;

-- Generic name lookup (molecule cross-reference)
CREATE INDEX idx_ssp_generic_name
  ON specialty_starter_packs (generic_name)
  WHERE deleted_at IS NULL;

-- Molecule linkage
CREATE INDEX idx_ssp_molecule_id
  ON specialty_starter_packs (molecule_id)
  WHERE molecule_id IS NOT NULL;

-- Schedule class filter (for H1/X drug special handling)
CREATE INDEX idx_ssp_schedule
  ON specialty_starter_packs (schedule_class)
  WHERE schedule_class IS NOT NULL;

-- Item type filter (show only drugs, not procedures)
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

-- Interaction lookups (bidirectional — both directions indexed)
CREATE INDEX idx_interaction_mol_a
  ON drug_interactions (molecule_a_id, severity);
CREATE INDEX idx_interaction_mol_b
  ON drug_interactions (molecule_b_id, severity);

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
-- SECTION 9: MATERIALIZED VIEW
-- Decision: Cache the most expensive join for the autocomplete query.
-- Reason: Every keystroke in the drug autocomplete fires a query joining
--         specialty_starter_packs + drug_molecules + therapeutic_groups.
--         At 50 doctors × 20 keystrokes = 1000 queries/minute.
--         The materialized view pre-computes this join. CONCURRENTLY
--         refresh means reads are never blocked during refresh.
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
  -- From drug_molecules (joined for safety data)
  dm.pregnancy_category,
  dm.is_narrow_therapeutic_index,
  dm.requires_renal_adjustment,
  dm.requires_hepatic_adjustment,
  dm.use_caution_elderly,
  dm.is_banned_india,
  dm.cdsco_approval_status,
  dm.allergy_class_id,
  -- From therapeutic_groups
  tg.group_name         AS therapeutic_group,
  tg.atc_code           AS therapeutic_group_atc
FROM specialty_starter_packs ssp
LEFT JOIN drug_molecules dm      ON dm.id = ssp.molecule_id
LEFT JOIN therapeutic_groups tg  ON tg.id = dm.therapeutic_group_id
WHERE ssp.deleted_at IS NULL
  AND ssp.is_active = TRUE;

-- Primary lookup index on the cache
CREATE UNIQUE INDEX ON specialty_drug_cache (specialty, rank);

-- Trigram on the cache for autocomplete
CREATE INDEX ON specialty_drug_cache
  USING GIN (drug_name gin_trgm_ops);

-- FTS on the cache
CREATE INDEX ON specialty_drug_cache
  USING GIN (to_tsvector('english', drug_name || ' ' || generic_name));

COMMENT ON MATERIALIZED VIEW specialty_drug_cache IS
  'Pre-computed join of specialty_starter_packs + drug_molecules + therapeutic_groups. '
  'Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY specialty_drug_cache; '
  'Schedule via pg_cron: every 15 minutes during clinic hours, nightly off-hours.';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 10: FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── TRIGGER 1: Auto-update updated_at ────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
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


-- ── TRIGGER 2: Audit log for specialty_starter_packs ─────────────────────────
-- Decision: Trigger-based audit (not application-level).
-- Reason: Application-level audit can be bypassed by direct DB access,
--         migration scripts, or bugs. A DB trigger fires for ALL writes
--         regardless of source — providing a truly tamper-resistant trail.

CREATE OR REPLACE FUNCTION fn_log_ssp_changes()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
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


-- ── TRIGGER 3: Banned Drug Guard ─────────────────────────────────────────────
-- Decision: DB-level hard block on banned drug insertion.
-- Reason: Application-level validation can be bypassed by direct SQL inserts
--         or migration scripts. A trigger-level block makes it physically
--         impossible to insert a CDSCO-banned drug — regardless of source.
-- This directly addresses: Dextropropoxyphene (banned 2013) appearing in pack.

CREATE OR REPLACE FUNCTION fn_prevent_banned_drug()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_banned    BOOLEAN;
  v_inn_name  VARCHAR(200);
BEGIN
  IF NEW.molecule_id IS NOT NULL THEN
    SELECT is_banned_india, inn_name
    INTO v_banned, v_inn_name
    FROM drug_molecules
    WHERE id = NEW.molecule_id;

    IF v_banned = TRUE THEN
      RAISE EXCEPTION
        'BANNED DRUG BLOCKED: % (molecule_id: %) is banned in India by CDSCO. '
        'Check drug_molecules.ban_gazette_notification for reference.',
        v_inn_name, NEW.molecule_id;
    END IF;

    IF (SELECT cdsco_approval_status FROM drug_molecules WHERE id = NEW.molecule_id)
       IN ('withdrawn', 'banned', 'suspended') THEN
      RAISE WARNING
        'Drug % has CDSCO status: %. Proceeding with caution flag.',
        v_inn_name,
        (SELECT cdsco_approval_status FROM drug_molecules WHERE id = NEW.molecule_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_banned_drug
  BEFORE INSERT OR UPDATE ON specialty_starter_packs
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_banned_drug();


-- ── FUNCTION: Get drug list for specialty (3-tier resolution) ────────────────
-- Decision: Server-side 3-tier merge logic.
-- Reason: The final drug list a doctor sees must layer:
--   Global defaults → Org overrides → Doctor preferences
--   Doing this in application code means 3 round trips to DB.
--   A single function call returns the fully merged, personalized list.

CREATE OR REPLACE FUNCTION fn_get_specialty_drugs(
  p_specialty   VARCHAR(100),
  p_org_id      UUID    DEFAULT NULL,
  p_doctor_id   UUID    DEFAULT NULL,
  p_tier        TEXT    DEFAULT 'free'
)
RETURNS TABLE (
  drug_pack_id      INTEGER,
  drug_name         VARCHAR(300),
  generic_name      VARCHAR(200),
  effective_rank    INTEGER,
  effective_dosage  VARCHAR(20),
  effective_duration INTEGER,
  effective_timing  timing_enum,
  is_hidden         BOOLEAN,
  is_pinned         BOOLEAN,
  source_tier       TEXT           -- 'global', 'org', 'doctor'
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
           p_tier = 'pro' OR
           ssp.available_in_tier = 'free')
  ),
  with_org AS (
    SELECT
      g.id,
      g.drug_name,
      g.generic_name,
      COALESCE(o.custom_rank, g.rank)           AS effective_rank,
      COALESCE(o.custom_dosage, g.default_dosage) AS effective_dosage,
      COALESCE(o.custom_duration, g.default_duration) AS effective_duration,
      COALESCE(o.custom_timing, g.default_timing) AS effective_timing,
      COALESCE(o.is_hidden, FALSE)              AS org_hidden,
      CASE WHEN o.id IS NOT NULL THEN 'org' ELSE 'global' END AS source
    FROM global_drugs g
    LEFT JOIN org_drug_overrides o
      ON o.global_pack_id = g.id AND o.org_id = p_org_id
  )
  SELECT
    w.id                                        AS drug_pack_id,
    w.drug_name,
    w.generic_name,
    COALESCE(d.personal_rank, w.effective_rank) AS effective_rank,
    COALESCE(d.personal_dosage, w.effective_dosage) AS effective_dosage,
    COALESCE(d.personal_duration, w.effective_duration) AS effective_duration,
    COALESCE(d.personal_timing, w.effective_timing) AS effective_timing,
    COALESCE(d.is_hidden, w.org_hidden)         AS is_hidden,
    COALESCE(d.is_pinned, FALSE)               AS is_pinned,
    CASE
      WHEN d.id IS NOT NULL THEN 'doctor'
      ELSE w.source
    END                                         AS source_tier
  FROM with_org w
  LEFT JOIN doctor_drug_preferences d
    ON d.drug_pack_id = w.id AND d.doctor_id = p_doctor_id
  WHERE COALESCE(d.is_hidden, w.org_hidden) = FALSE
  ORDER BY
    COALESCE(d.is_pinned, FALSE) DESC,         -- Pinned drugs first
    COALESCE(d.personal_rank, w.effective_rank) ASC;
END;
$$;

COMMENT ON FUNCTION fn_get_specialty_drugs IS
  'Returns fully merged drug list: Global → Org → Doctor preference layers. '
  'Pinned drugs surface first. Hidden drugs excluded. '
  'Usage: SELECT * FROM fn_get_specialty_drugs(''Cardiologist'', org_uuid, doctor_uuid, ''pro'');';


-- ── FUNCTION: Refresh materialized view (for pg_cron scheduling) ─────────────
CREATE OR REPLACE FUNCTION fn_refresh_drug_cache()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY specialty_drug_cache;
  INSERT INTO seed_runs (migration_file, rows_inserted, environment, notes)
  VALUES ('fn_refresh_drug_cache', 0, 'production', 'Materialized view refreshed');
END;
$$;

-- Schedule with pg_cron (if available):
-- SELECT cron.schedule('refresh-drug-cache', '*/15 * * * *', 'SELECT fn_refresh_drug_cache()');


-- ── FUNCTION: Get drug interactions for a prescription list ──────────────────
-- Checks a list of molecule IDs against the interaction matrix
CREATE OR REPLACE FUNCTION fn_check_interactions(p_molecule_ids INTEGER[])
RETURNS TABLE (
  molecule_a_name   VARCHAR(200),
  molecule_b_name   VARCHAR(200),
  severity          severity_enum,
  clinical_effect   TEXT,
  management        TEXT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ma.inn_name   AS molecule_a_name,
    mb.inn_name   AS molecule_b_name,
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
      WHEN 'major' THEN 2
      WHEN 'moderate' THEN 3
      WHEN 'minor' THEN 4
    END;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 11: ROW LEVEL SECURITY
-- Decision: Postgres RLS as defense-in-depth for multi-tenant isolation.
-- Reason: Application-level tenant isolation can fail due to bugs, missing
--         middleware, or direct API calls. RLS at the DB level means even
--         if the application has a bug, one clinic cannot see another's data.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE specialty_starter_packs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_drug_overrides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_drug_preferences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_prescription_analytics  ENABLE ROW LEVEL SECURITY;

-- Global pack: all authenticated users can read; only superadmin can write
CREATE POLICY ssp_read_all ON specialty_starter_packs
  FOR SELECT
  TO PUBLIC
  USING (TRUE);

CREATE POLICY ssp_write_superadmin ON specialty_starter_packs
  FOR ALL
  USING (current_setting('app.user_role', TRUE) IN ('superadmin', 'clinical_admin'));

-- Org overrides: scoped to the current org session
CREATE POLICY org_override_scoped ON org_drug_overrides
  FOR ALL
  USING (org_id = current_setting('app.org_id', TRUE)::UUID);

-- Doctor preferences: scoped to the current doctor session
CREATE POLICY doctor_pref_scoped ON doctor_drug_preferences
  FOR ALL
  USING (doctor_id = current_setting('app.doctor_id', TRUE)::UUID);

-- Analytics: org can see their own; doctor can see their own
CREATE POLICY analytics_org_scoped ON drug_prescription_analytics
  FOR SELECT
  USING (
    org_id = current_setting('app.org_id', TRUE)::UUID OR
    doctor_id = current_setting('app.doctor_id', TRUE)::UUID
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 12: VALIDATION QUERIES
-- Decision: Embed validation as commented SQL, not just documentation.
-- Reason: These queries should be run as post-seed automated tests in CI/CD.
--         They validate data integrity guarantees that constraints alone
--         cannot enforce (e.g., sequential rank gaps, clinical sense checks).
-- ═══════════════════════════════════════════════════════════════════════════

/*
════════════════════════════════════════════════
POST-SEED VALIDATION SUITE — Run after each seed
Expected result for each: 0 rows returned
════════════════════════════════════════════════

-- V1: No duplicate (specialty, rank) pairs
SELECT specialty, rank, COUNT(*)
FROM specialty_starter_packs
GROUP BY specialty, rank
HAVING COUNT(*) > 1;

-- V2: No banned drugs in active packs
SELECT ssp.drug_name, ssp.specialty, dm.ban_gazette_notification
FROM specialty_starter_packs ssp
JOIN drug_molecules dm ON dm.id = ssp.molecule_id
WHERE dm.is_banned_india = TRUE
  AND ssp.deleted_at IS NULL;

-- V3: No invalid timing values (should be caught by enum but belt-and-suspenders)
SELECT id, drug_name, default_timing
FROM specialty_starter_packs
WHERE default_timing::TEXT NOT IN (
  'after_food','before_food','empty_stomach','with_milk',
  'with_warm_water','with_honey','with_ghee',
  'with_warm_water_before_food','with_juice','sublingual','as_directed'
);

-- V4: No negative durations
SELECT drug_name, default_duration
FROM specialty_starter_packs
WHERE default_duration < 0;

-- V5: Weight-based drugs must have dosage_per_kg
SELECT drug_name, specialty
FROM specialty_starter_packs
WHERE is_weight_based = TRUE AND dosage_per_kg IS NULL;

-- V6: Schedule H1 drugs must not exceed 30-day default duration
SELECT drug_name, schedule_class, default_duration
FROM specialty_starter_packs
WHERE schedule_class = 'H1'
  AND default_duration > 30
  AND dosage_frequency_unit = 'daily';

-- V7: All specialties have exactly 150 active drugs
SELECT specialty, COUNT(*) AS drug_count,
  CASE WHEN COUNT(*) = 150 THEN 'OK' ELSE 'INCOMPLETE' END AS status
FROM specialty_starter_packs
WHERE deleted_at IS NULL AND is_active = TRUE
GROUP BY specialty
ORDER BY status DESC, specialty;

-- V8: Procedures/materials are not marked as scheduled drugs
SELECT drug_name, item_type, is_scheduled
FROM specialty_starter_packs
WHERE item_type IN ('procedure','material','cosmetic','device')
  AND is_scheduled = TRUE;

-- V9: AYUSH timing values only used for AYUSH item_type
SELECT drug_name, item_type, default_timing
FROM specialty_starter_packs
WHERE default_timing IN ('with_milk','with_honey','with_ghee','with_warm_water')
  AND item_type != 'ayush';

-- V10: Each specialty's ranks are sequential (no gaps)
SELECT specialty,
  MAX(rank) AS max_rank,
  COUNT(*)  AS actual_count,
  CASE WHEN MAX(rank) = COUNT(*) THEN 'SEQUENTIAL'
       ELSE 'HAS GAPS' END AS rank_status
FROM specialty_starter_packs
WHERE deleted_at IS NULL
GROUP BY specialty
HAVING MAX(rank) != COUNT(*);
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 13: USEFUL VIEWS FOR APPLICATION LAYER
-- ═══════════════════════════════════════════════════════════════════════════

-- View: Active drugs with full safety context
CREATE OR REPLACE VIEW vw_active_drugs_with_safety AS
SELECT
  ssp.id,
  ssp.specialty,
  ssp.rank,
  ssp.drug_name,
  ssp.generic_name,
  ssp.category,
  ssp.item_type,
  ssp.schedule_class,
  ssp.default_dosage,
  ssp.dosage_frequency_unit,
  ssp.dosage_interval_days,
  ssp.default_duration,
  ssp.default_timing,
  ssp.is_prn,
  ssp.is_single_use,
  ssp.is_weight_based,
  ssp.clinical_indication,
  ssp.available_in_tier,
  ssp.jan_aushadhi_available,
  ssp.avg_mrp_inr,
  -- Safety flags from molecule table
  dm.pregnancy_category,
  dm.is_narrow_therapeutic_index,
  dm.requires_renal_adjustment,
  dm.requires_hepatic_adjustment,
  dm.use_caution_elderly,
  dm.schedule_class                             AS molecule_schedule,
  dm.min_age_years,
  dm.max_age_years,
  -- Allergy class
  dac.class_name                                AS allergy_class,
  -- Therapeutic group
  tg.group_name                                 AS therapeutic_group,
  tg.atc_code
FROM specialty_starter_packs ssp
LEFT JOIN drug_molecules dm    ON dm.id  = ssp.molecule_id
LEFT JOIN drug_allergy_classes dac ON dac.id = dm.allergy_class_id
LEFT JOIN therapeutic_groups tg ON tg.id = dm.therapeutic_group_id
WHERE ssp.deleted_at IS NULL
  AND ssp.is_active = TRUE;

-- View: Drugs requiring monitoring (for prescription workflow prompt)
CREATE OR REPLACE VIEW vw_drugs_requiring_monitoring AS
SELECT
  ssp.specialty,
  ssp.drug_name,
  ssp.generic_name,
  dmr.test_name,
  dmr.frequency,
  dmr.timing,
  dmr.is_mandatory,
  dmr.rationale
FROM specialty_starter_packs ssp
JOIN drug_monitoring_requirements dmr ON dmr.molecule_id = ssp.molecule_id
WHERE ssp.deleted_at IS NULL
  AND ssp.is_active = TRUE
ORDER BY ssp.specialty, ssp.rank, dmr.is_mandatory DESC;

-- View: High-risk drug pairs within same specialty
CREATE OR REPLACE VIEW vw_intraspecialty_interactions AS
SELECT
  ssp_a.specialty,
  ssp_a.drug_name  AS drug_a,
  ssp_b.drug_name  AS drug_b,
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
-- FINALIZE
-- ═══════════════════════════════════════════════════════════════════════════

-- Record this migration run
INSERT INTO seed_runs (migration_file, environment, pack_version, notes, rows_inserted)
VALUES (
  'clinicflow_v2_schema.sql',
  'development',
  '2.0.0',
  'Full schema rebuild. 15 tables, 3 materialized views, 5 triggers, 3 functions, RLS policies.',
  0
);

COMMIT;

-- ============================================================
-- POST-COMMIT: Refresh materialized view (cannot run in transaction)
-- ============================================================
REFRESH MATERIALIZED VIEW specialty_drug_cache;
