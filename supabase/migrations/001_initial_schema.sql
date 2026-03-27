-- ============================================================
-- ClinicFlow V1 — Initial Schema
-- PostgreSQL 15 via Supabase Managed Cloud ap-south-1 (Mumbai)
-- Run in order — each section depends on those above it.
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy drug search

-- ── Enums ───────────────────────────────────────────────────
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

-- ============================================================
-- 1. clinics
-- No RLS — accessed during auth before clinic_id is known.
-- ============================================================
CREATE TABLE clinics (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  registration_no TEXT,
  clinic_mode     clinic_mode NOT NULL DEFAULT 'solo',
  primary_color   TEXT DEFAULT '#0ea5e9',    -- WCAG AA validated before save
  logo_url        TEXT,
  clinic_pin_code TEXT,                      -- V2 hook: outbreak radar
  config          JSONB DEFAULT '{
    "recall_engine_enabled": false,
    "drug_interactions_enabled": false,
    "consent_version": "v1.0",
    "avg_consultation_seconds": 300,
    "languages": ["en","hi"]
  }'::jsonb,
  state           TEXT,
  gst_number      TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Public read view for QR check-in (V2):
CREATE VIEW clinic_public_profiles AS
  SELECT id, name, address FROM clinics WHERE is_active = TRUE;

-- ============================================================
-- 2. staff
-- ============================================================
CREATE TABLE staff (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  full_name   TEXT,                         -- alias kept for JWT enrichment
  email       TEXT NOT NULL,
  role        staff_role NOT NULL,
  specialty   TEXT,
  reg_number  TEXT,                         -- NMC registration number
  qualification TEXT,                       -- MBBS / MD / etc.
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_clinic  ON staff(clinic_id);
CREATE INDEX idx_staff_user_id ON staff(user_id);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_tenant ON staff
  USING (
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
    AND is_active = TRUE
  )
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 3. staff_invites
-- ============================================================
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

-- ============================================================
-- 4. consent_templates
-- ============================================================
CREATE TABLE consent_templates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id       UUID REFERENCES clinics(id) ON DELETE CASCADE,  -- NULL = global default
  version         TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'en',
  content         TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_clinic ON consent_templates(clinic_id);

ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_tmpl_select ON consent_templates
  FOR SELECT USING (
    clinic_id IS NULL OR
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
  );
CREATE POLICY consent_tmpl_write ON consent_templates
  FOR ALL
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 5. patients
-- NEVER hard-delete. Erasure = anonymization only. DPDP compliance.
-- Mobile NOT unique — families share phones. Always return array.
-- NEVER store Aadhaar numbers.
-- ============================================================
CREATE TABLE patients (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  dob                 DATE,
  gender              TEXT CHECK (gender IN ('male','female','other','prefer_not_to_say')),
  mobile              TEXT NOT NULL,              -- NOT unique — families share phones
  address             TEXT,
  blood_group         TEXT,
  emergency_name      TEXT,
  emergency_phone     TEXT,
  preferred_language  TEXT DEFAULT 'en',
  abha_id             TEXT,                       -- V2 hook: ABHA integration
  is_anonymized       BOOLEAN DEFAULT FALSE,
  anonymized_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
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

-- ============================================================
-- 6. patient_consents
-- Inserted in SAME transaction as patient row (atomicity).
-- ============================================================
CREATE TABLE patient_consents (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID NOT NULL REFERENCES patients(id),
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  consent_text     TEXT NOT NULL,
  consent_version  TEXT NOT NULL,
  consented_at     TIMESTAMPTZ DEFAULT NOW(),
  ip_address       TEXT,
  captured_by      UUID REFERENCES staff(id),    -- NULL if self-served (V2 kiosk)
  is_withdrawn     BOOLEAN DEFAULT FALSE,
  withdrawn_at     TIMESTAMPTZ,
  withdrawn_by     UUID REFERENCES staff(id)
);

CREATE INDEX idx_consents_patient ON patient_consents(patient_id);
CREATE INDEX idx_consents_clinic  ON patient_consents(clinic_id);

ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY consents_tenant ON patient_consents
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 7. sessions
-- ============================================================
CREATE TABLE sessions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  doctor_id   UUID NOT NULL REFERENCES staff(id),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  status      session_status DEFAULT 'open',
  opened_at   TIMESTAMPTZ DEFAULT NOW(),
  closed_at   TIMESTAMPTZ,
  avg_consultation_seconds INTEGER DEFAULT 300   -- updated on each COMPLETED transition
);

CREATE INDEX idx_sessions_clinic ON sessions(clinic_id, date);
CREATE INDEX idx_sessions_doctor ON sessions(doctor_id, date);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant ON sessions
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- ============================================================
-- 8. session_counters (atomic token generation — no race conditions)
-- ============================================================
CREATE TABLE session_counters (
  session_id    UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  token_count   INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE session_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY counters_tenant ON session_counters
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 9. queue_entries (core table)
-- ALL mutations go through OCC: WHERE id=$id AND version=$v
-- COMPLETED and CANCELLED are terminal — zero transitions out.
-- Timestamps set by DB trigger ONLY — never by client.
-- ============================================================
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
  identity_verified        BOOLEAN NOT NULL DEFAULT FALSE,   -- amber lock gate
  notes                    TEXT,
  sync_status              sync_status NOT NULL DEFAULT 'synced',   -- V2 offline hook
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  called_at                TIMESTAMPTZ,                       -- set by trigger only
  consultation_started_at  TIMESTAMPTZ,                       -- set by trigger only
  completed_at             TIMESTAMPTZ                        -- set by trigger only
);

CREATE INDEX idx_qe_session ON queue_entries(session_id);
CREATE INDEX idx_qe_clinic  ON queue_entries(clinic_id);
CREATE INDEX idx_qe_status  ON queue_entries(session_id, status);

ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY qe_tenant ON queue_entries
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;

-- ============================================================
-- 10. queue_display_sync (TV display — zero PII in this table)
-- Updated by trigger on queue_entries — never written directly.
-- ============================================================
CREATE TABLE queue_display_sync (
  session_id      UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  current_token   TEXT,
  current_name    TEXT,    -- first name only (no full PII)
  next_token      TEXT,
  queue_count     INTEGER NOT NULL DEFAULT 0,
  session_status  TEXT NOT NULL DEFAULT 'open',
  clinic_name     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE queue_display_sync ENABLE ROW LEVEL SECURITY;
-- Display role can read — scoped JWT enforces clinic_id
CREATE POLICY display_read ON queue_display_sync
  FOR SELECT
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE queue_display_sync;

-- ============================================================
-- 11. payments (V1 — cash/UPI flag only)
-- Razorpay columns reserved for V2.
-- ============================================================
CREATE TABLE payments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id),
  patient_id     UUID NOT NULL REFERENCES patients(id),
  amount_paise   INTEGER NOT NULL DEFAULT 0,   -- always paise (₹ × 100)
  method         payment_mode NOT NULL DEFAULT 'cash',
  status         payment_status NOT NULL DEFAULT 'pending',
  collected_by   UUID REFERENCES staff(id),
  version        INTEGER NOT NULL DEFAULT 1,
  -- V2 hooks (Razorpay):
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  paid_at        TIMESTAMPTZ
);

CREATE INDEX idx_payments_clinic         ON payments(clinic_id);
CREATE INDEX idx_payments_queue_entry_id ON payments(queue_entry_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON payments
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 12. master_drugs (global, managed by ClinicFlow team)
-- All clinics can read. No clinic can write.
-- ============================================================
CREATE TABLE master_drugs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  generic_name TEXT,
  category     TEXT,
  schedule     TEXT,                           -- H, H1, X, OTC
  is_banned    BOOLEAN DEFAULT FALSE,
  ban_date     DATE,
  ban_reason   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Fuzzy trigram index for fast drug search
CREATE INDEX idx_drugs_name   ON master_drugs USING gin(name gin_trgm_ops);
CREATE INDEX idx_drugs_banned ON master_drugs(is_banned) WHERE is_banned = TRUE;

ALTER TABLE master_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY drugs_read ON master_drugs FOR SELECT USING (TRUE);
-- No INSERT/UPDATE/DELETE policy — clinics cannot write to master

-- ============================================================
-- 13. doctor_drug_preferences (per-doctor batch, 100-500 rows)
-- Seeded from specialty_starter_packs on onboarding.
-- usage_count drives smart dosage pre-fill and suggestions.
-- ============================================================
CREATE TABLE doctor_drug_preferences (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  doctor_id        UUID NOT NULL REFERENCES staff(id),
  drug_name        TEXT NOT NULL,
  generic_name     TEXT,
  category         TEXT,
  usage_count      INTEGER NOT NULL DEFAULT 1,
  default_dosage   TEXT,       -- e.g. '1-0-1'
  default_duration INTEGER,    -- days
  default_timing   TEXT,       -- 'after_food', 'before_food', 'empty_stomach'
  is_from_master   BOOLEAN DEFAULT TRUE,
  master_drug_id   UUID REFERENCES master_drugs(id),
  sync_status      sync_status DEFAULT 'synced',
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ddp_doctor ON doctor_drug_preferences(doctor_id);
CREATE INDEX idx_ddp_clinic ON doctor_drug_preferences(clinic_id);
CREATE UNIQUE INDEX idx_ddp_unique ON doctor_drug_preferences(doctor_id, drug_name);

ALTER TABLE doctor_drug_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ddp_tenant ON doctor_drug_preferences
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 14. custom_clinic_drugs (per-clinic sandbox — never touches master)
-- ============================================================
CREATE TABLE custom_clinic_drugs (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id          UUID NOT NULL REFERENCES clinics(id),
  doctor_id          UUID REFERENCES staff(id),
  drug_name          TEXT NOT NULL,
  usage_count        INTEGER DEFAULT 1,
  flagged_for_review BOOLEAN DEFAULT FALSE,    -- set when 50+ clinics add same drug
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_custom_clinic ON custom_clinic_drugs(clinic_id);

ALTER TABLE custom_clinic_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_drugs_tenant ON custom_clinic_drugs
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ============================================================
-- 15. drug_instructions_i18n (patient dosage instructions)
-- Drug names: ALWAYS English. Instructions: local language. NMC mandate.
-- ============================================================
CREATE TABLE drug_instructions_i18n (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dosage_code  TEXT NOT NULL,    -- e.g. '1-0-1', '0-0-1', 'SOS'
  timing_code  TEXT NOT NULL,    -- e.g. 'after_food', 'before_food', 'empty_stomach'
  language     TEXT NOT NULL,    -- e.g. 'hi', 'mr', 'ta', 'en'
  instruction  TEXT NOT NULL,    -- e.g. 'सुबह और शाम, खाने के बाद'
  UNIQUE (dosage_code, timing_code, language)
);

-- Global table, read-only for all
ALTER TABLE drug_instructions_i18n ENABLE ROW LEVEL SECURITY;
CREATE POLICY i18n_read ON drug_instructions_i18n FOR SELECT USING (TRUE);

-- ============================================================
-- 16. audit_logs (append-only — no UPDATE or DELETE ever)
-- staff_id comes from JWT claims in trigger — no extra DB lookup.
-- PII columns (name, mobile) excluded from old_value/new_value.
-- ============================================================
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  clinic_id   UUID NOT NULL,
  staff_id    UUID,              -- from JWT claims
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  old_value   JSONB,             -- PII excluded (DPDP compliance)
  new_value   JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_clinic ON audit_logs(clinic_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (TRUE);
CREATE POLICY audit_read   ON audit_logs FOR SELECT
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
-- Deliberately no UPDATE or DELETE policy — enforces append-only

-- ============================================================
-- V2 HOOK TABLES (schema only — no application code in V1)
-- ============================================================

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

CREATE TABLE analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  icd10_code  TEXT,
  drug_name   TEXT,
  pin_code    TEXT,
  specialty   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
  -- Fully anonymous: NO clinic_id, NO patient_id, NO staff_id
);

CREATE TABLE kiosk_checkins (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  mobile      TEXT NOT NULL,
  otp_hash    TEXT,
  verified_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- ── Trigger 1: Timestamp setter (BEFORE UPDATE) ─────────────
-- DB is the only clock. Client NEVER sends timestamps.
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

-- ── Trigger 2: Audit logger (AFTER UPDATE) ──────────────────
-- Reads staff_id from JWT claims — no extra DB lookup.
-- Excludes PII from log entries (DPDP compliance).
CREATE OR REPLACE FUNCTION log_queue_change()
RETURNS TRIGGER AS $$
DECLARE
  v_staff_id UUID;
  v_claims   JSONB;
BEGIN
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
    jsonb_build_object(
      'status',       OLD.status,
      'version',      OLD.version,
      'token_number', OLD.token_number
    ),
    jsonb_build_object(
      'status',       NEW.status,
      'version',      NEW.version,
      'token_number', NEW.token_number
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_audit
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION log_queue_change();

-- ── Trigger 3: TV display sync (AFTER UPDATE) ───────────────
-- Keeps queue_display_sync current. Zero PII in the broadcast.
CREATE OR REPLACE FUNCTION sync_display()
RETURNS TRIGGER AS $$
DECLARE
  v_current_token TEXT;
  v_next_token    TEXT;
  v_current_name  TEXT;
  v_queue_count   INTEGER;
  v_session_status TEXT;
  v_clinic_name   TEXT;
BEGIN
  -- Current = most recently CALLED token (first name only for display)
  SELECT
    qe.token_prefix || '-' || qe.token_number,
    split_part(p.name, ' ', 1)   -- first name only — no surname on TV
  INTO v_current_token, v_current_name
  FROM queue_entries qe
  JOIN patients p ON p.id = qe.patient_id
  WHERE qe.session_id = NEW.session_id
    AND qe.status = 'CALLED'
  ORDER BY qe.called_at DESC LIMIT 1;

  -- Next = first CHECKED_IN token
  SELECT token_prefix || '-' || token_number INTO v_next_token
  FROM queue_entries
  WHERE session_id = NEW.session_id
    AND status = 'CHECKED_IN'
  ORDER BY created_at ASC LIMIT 1;

  -- Waiting count
  SELECT COUNT(*) INTO v_queue_count
  FROM queue_entries
  WHERE session_id = NEW.session_id
    AND status IN ('CHECKED_IN', 'CALLED');

  -- Session and clinic info
  SELECT s.status::TEXT, c.name
  INTO v_session_status, v_clinic_name
  FROM sessions s
  JOIN clinics c ON c.id = s.clinic_id
  WHERE s.id = NEW.session_id;

  INSERT INTO queue_display_sync(
    session_id, clinic_id, current_token, current_name,
    next_token, queue_count, session_status, clinic_name, updated_at
  )
  VALUES (
    NEW.session_id, NEW.clinic_id,
    v_current_token, v_current_name,
    v_next_token, COALESCE(v_queue_count, 0),
    COALESCE(v_session_status, 'open'), COALESCE(v_clinic_name, ''),
    NOW()
  )
  ON CONFLICT (session_id)
  DO UPDATE SET
    current_token  = EXCLUDED.current_token,
    current_name   = EXCLUDED.current_name,
    next_token     = EXCLUDED.next_token,
    queue_count    = EXCLUDED.queue_count,
    session_status = EXCLUDED.session_status,
    clinic_name    = EXCLUDED.clinic_name,
    updated_at     = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_display_sync
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION sync_display();

-- ── Trigger 4: Average consultation time (AFTER UPDATE) ─────
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

-- ============================================================
-- RPCs (functions called from the frontend)
-- ============================================================

-- ── RPC 1: Atomic token generation ─────────────────────────
CREATE OR REPLACE FUNCTION increment_session_token(p_session_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_token INTEGER;
BEGIN
  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session counter not found for session %', p_session_id;
  END IF;

  RETURN v_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 2: Create patient + consent (atomic) ─────────────────
CREATE OR REPLACE FUNCTION create_patient_with_consent(
  p_clinic_id       UUID,
  p_name            TEXT,
  p_mobile          TEXT,
  p_dob             DATE,
  p_gender          TEXT,
  p_preferred_lang  TEXT,
  p_consent_text    TEXT,
  p_consent_version TEXT,
  p_captured_by     UUID,
  p_session_id      UUID
)
RETURNS JSONB AS $$
DECLARE
  v_patient_id UUID;
  v_token      INTEGER;
  v_entry_id   UUID;
BEGIN
  -- Insert patient
  INSERT INTO patients(clinic_id, name, mobile, dob, gender, preferred_language)
  VALUES (p_clinic_id, p_name, p_mobile, p_dob, p_gender, p_preferred_lang)
  RETURNING id INTO v_patient_id;

  -- Insert consent in same transaction
  INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version, captured_by)
  VALUES (v_patient_id, p_clinic_id, p_consent_text, p_consent_version, p_captured_by);

  -- Atomic token generation
  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  -- Create queue entry
  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, source)
  VALUES (p_clinic_id, p_session_id, v_patient_id, v_token, 'reception')
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'patient_id',     v_patient_id,
    'queue_entry_id', v_entry_id,
    'token_number',   v_token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 3: Add existing patient to queue (with consent check) ─
CREATE OR REPLACE FUNCTION add_patient_to_queue(
  p_clinic_id       UUID,
  p_patient_id      UUID,
  p_session_id      UUID,
  p_consent_text    TEXT,
  p_consent_version TEXT,
  p_captured_by     UUID
)
RETURNS JSONB AS $$
DECLARE
  v_token    INTEGER;
  v_entry_id UUID;
  v_existing_consent UUID;
BEGIN
  -- Check for existing valid consent
  SELECT id INTO v_existing_consent
  FROM patient_consents
  WHERE patient_id      = p_patient_id
    AND clinic_id       = p_clinic_id
    AND consent_version = p_consent_version
    AND is_withdrawn    = FALSE
  LIMIT 1;

  -- Insert new consent if not already present
  IF v_existing_consent IS NULL THEN
    INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version, captured_by)
    VALUES (p_patient_id, p_clinic_id, p_consent_text, p_consent_version, p_captured_by);
  END IF;

  -- Atomic token
  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  -- Queue entry
  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, source)
  VALUES (p_clinic_id, p_session_id, p_patient_id, v_token, 'reception')
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'queue_entry_id', v_entry_id,
    'token_number',   v_token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 4: Rapid consultation (solo doctor mode) ─────────────
CREATE OR REPLACE FUNCTION start_rapid_consultation(
  p_clinic_id  UUID,
  p_doctor_id  UUID,
  p_session_id UUID,
  p_mobile     TEXT,
  p_name       TEXT,
  p_patient_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_patient_id    UUID;
  v_token         INTEGER;
  v_entry_id      UUID;
  v_family_members JSONB;
  v_consent_version TEXT;
  v_consent_text    TEXT;
BEGIN
  -- If patient_id provided, use it directly
  IF p_patient_id IS NOT NULL THEN
    v_patient_id := p_patient_id;
  ELSE
    -- Look up by mobile in this clinic
    SELECT id INTO v_patient_id
    FROM patients
    WHERE clinic_id = p_clinic_id AND mobile = p_mobile AND is_anonymized = FALSE
    LIMIT 1;

    IF NOT FOUND THEN
      -- New patient — create with rapid consent
      SELECT config->>'consent_version' INTO v_consent_version
      FROM clinics WHERE id = p_clinic_id;

      SELECT content INTO v_consent_text
      FROM consent_templates
      WHERE (clinic_id = p_clinic_id OR clinic_id IS NULL)
        AND version = COALESCE(v_consent_version, 'v1.0')
        AND language = 'en' AND is_active = TRUE
      ORDER BY clinic_id NULLS LAST LIMIT 1;

      INSERT INTO patients(clinic_id, name, mobile)
      VALUES (p_clinic_id, p_name, p_mobile)
      RETURNING id INTO v_patient_id;

      INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version, captured_by)
      VALUES (v_patient_id, p_clinic_id, COALESCE(v_consent_text, ''), COALESCE(v_consent_version, 'v1.0'), p_doctor_id);
    ELSE
      -- Check for family members sharing this mobile
      SELECT json_agg(json_build_object('id', id, 'name', name, 'dob', dob))
      INTO v_family_members
      FROM patients
      WHERE clinic_id = p_clinic_id AND mobile = p_mobile AND is_anonymized = FALSE;

      -- If multiple family members, return them for selection
      IF jsonb_array_length(v_family_members) > 1 THEN
        RETURN jsonb_build_object(
          'queue_entry_id', NULL,
          'patient_id',     NULL,
          'family_members', v_family_members
        );
      END IF;
    END IF;
  END IF;

  -- Atomic token generation
  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  -- Queue entry
  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, source, identity_verified)
  VALUES (p_clinic_id, p_session_id, v_patient_id, v_token, 'doctor_rapid', TRUE)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'queue_entry_id', v_entry_id,
    'patient_id',     v_patient_id,
    'family_members', NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 5: Z-Report (end-of-day summary) ────────────────────
CREATE OR REPLACE FUNCTION get_session_z_report(p_session_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_patients', COUNT(qe.id),
    'completed',      COUNT(qe.id) FILTER (WHERE qe.status = 'COMPLETED'),
    'no_shows',       COUNT(qe.id) FILTER (WHERE qe.status = 'NO_SHOW'),
    'cash_paise',     COALESCE(SUM(p.amount_paise) FILTER (WHERE p.method = 'cash' AND p.status = 'paid'), 0),
    'upi_paise',      COALESCE(SUM(p.amount_paise) FILTER (WHERE p.method = 'upi'  AND p.status = 'paid'), 0)
  )
  INTO v_result
  FROM queue_entries qe
  LEFT JOIN payments p ON p.queue_entry_id = qe.id
  WHERE qe.session_id = p_session_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 6: DPDP patient data export (Section 11) ────────────
CREATE OR REPLACE FUNCTION export_patient_data(p_patient_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'patient',       row_to_json(p.*),
      'consents',      COALESCE(json_agg(DISTINCT pc.*), '[]'::json),
      'queue_history', COALESCE(json_agg(DISTINCT qe.*), '[]'::json)
    )
    FROM patients p
    LEFT JOIN patient_consents pc ON pc.patient_id = p.id
    LEFT JOIN queue_entries    qe ON qe.patient_id = p.id
    WHERE p.id = p_patient_id
    GROUP BY p.id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 7: Patient anonymization (DPDP erasure) ─────────────
CREATE OR REPLACE FUNCTION anonymize_patient(p_patient_id UUID, p_clinic_id UUID)
RETURNS VOID AS $$
BEGIN
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
  WHERE id = p_patient_id AND clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RPC 8: Seed doctor drug batch from specialty starter pack ─
CREATE OR REPLACE FUNCTION seed_doctor_drug_batch(
  p_doctor_id  UUID,
  p_clinic_id  UUID,
  p_specialty  TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO doctor_drug_preferences(
    clinic_id, doctor_id, drug_name, generic_name, category,
    usage_count, default_dosage, default_duration, default_timing, is_from_master
  )
  SELECT
    p_clinic_id, p_doctor_id,
    drug_name, generic_name, category,
    1, default_dosage, default_duration, default_timing, TRUE
  FROM specialty_starter_packs
  WHERE specialty = p_specialty
  ORDER BY rank ASC
  LIMIT 150
  ON CONFLICT (doctor_id, drug_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Default consent template (English + Hindi)
-- Satisfies all 7 DPDP requirements.
-- Seeded as global defaults (clinic_id = NULL).
-- ============================================================
INSERT INTO consent_templates(clinic_id, version, language, content, is_active) VALUES
(NULL, 'v1.0', 'en',
'I consent to the collection and processing of my personal health information by this clinic for the purpose of providing medical care. I understand that:
1. My data will be used only for my medical treatment and related care coordination.
2. My data will be stored securely and protected against unauthorized access.
3. I have the right to access, correct, or request erasure of my data.
4. My data will not be shared with third parties without my explicit consent, except as required by law.
5. I may withdraw this consent at any time by notifying the clinic in writing.
6. The clinic will retain my records for the period required by applicable law.
7. I have read and understood this consent in a language I comprehend.',
TRUE),
(NULL, 'v1.0', 'hi',
'मैं इस क्लिनिक द्वारा चिकित्सा सेवा प्रदान करने के उद्देश्य से मेरी व्यक्तिगत स्वास्थ्य जानकारी के संग्रह और प्रसंस्करण के लिए सहमति देता/देती हूं। मैं समझता/समझती हूं कि:
1. मेरे डेटा का उपयोग केवल मेरे चिकित्सा उपचार के लिए किया जाएगा।
2. मेरे डेटा को सुरक्षित रूप से संग्रहीत किया जाएगा।
3. मुझे अपने डेटा तक पहुंच, सुधार या मिटाने का अधिकार है।
4. मेरे डेटा को मेरी स्पष्ट सहमति के बिना किसी तीसरे पक्ष के साथ साझा नहीं किया जाएगा।
5. मैं किसी भी समय इस सहमति को वापस ले सकता/सकती हूं।
6. क्लिनिक लागू कानून द्वारा आवश्यक अवधि के लिए मेरे रिकॉर्ड रखेगा।
7. मैंने यह सहमति अपनी समझ की भाषा में पढ़ी और समझी है।',
TRUE);

-- ============================================================
-- specialty_starter_packs (seed table — maintained by ClinicFlow team)
-- ============================================================
CREATE TABLE specialty_starter_packs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  specialty        TEXT NOT NULL,
  rank             INTEGER NOT NULL,
  drug_name        TEXT NOT NULL,
  generic_name     TEXT,
  category         TEXT,
  default_dosage   TEXT,
  default_duration INTEGER,
  default_timing   TEXT
);

CREATE INDEX idx_ssp_specialty ON specialty_starter_packs(specialty, rank);

-- Global read-only for seeding
ALTER TABLE specialty_starter_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ssp_read ON specialty_starter_packs FOR SELECT USING (TRUE);
