-- ============================================================
-- ClinicFlow V1 — Clean Schema
-- Target: Supabase ap-south-1 (Mumbai)
-- Date: 2026-03-28
--
-- Fixes vs old Tokyo project:
--   • staff RLS enabled (was off — multi-tenant isolation broken)
--   • queue_display_sync: removed current_name (PII on TV screen)
--   • sync_display: SECURITY DEFINER (was INVOKER — TV never updated)
--   • start_rapid_consultation: jsonb_agg not json_agg (type mismatch bug)
--   • create_onboarding_clinic: removed full_name column reference
--   • All functions: SET search_path = public (prevent search_path injection)
--   • All functions: SECURITY DEFINER consistently
--   • visits/appointments/kiosk_checkins: RLS enabled (were exposed)
--   • queue_entries: UNIQUE(session_id, token_number) DB-level guarantee
--   • Dropped: create_new_patient (debugging duplicate)
--   • Dropped: staff.full_name (debugging duplicate of name)
--   • pg_trgm: installed in extensions schema not public
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────
-- 1. ENUMS
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 2. CORE V1 TABLES
-- ─────────────────────────────────────────────────────────────

-- 2.1 clinics
-- No RLS — accessed during onboarding before JWT clinic_id is set
CREATE TABLE clinics (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  registration_no TEXT,
  state           TEXT,                          -- India state for registration
  gst_number      TEXT,                          -- GST for billing receipts
  clinic_mode     clinic_mode NOT NULL DEFAULT 'solo',
  primary_color   TEXT DEFAULT '#0ea5e9',        -- WCAG AA validated before save
  logo_url        TEXT,
  clinic_pin_code TEXT,                          -- V2 hook: outbreak radar
  config          JSONB DEFAULT '{
    "recall_engine_enabled": false,
    "drug_interactions_enabled": false,
    "consent_version": "v1.0",
    "avg_consultation_seconds": 300,
    "languages": ["en","hi"]
  }'::jsonb,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- No-PII public view for QR check-in (V2 hook)
CREATE VIEW clinic_public_profiles AS
  SELECT id, name, address FROM clinics WHERE is_active = TRUE;

-- 2.2 staff
CREATE TABLE staff (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          staff_role NOT NULL,
  specialty     TEXT,
  reg_number    TEXT,
  qualification TEXT,                            -- e.g. MBBS, MD
  totp_required BOOLEAN NOT NULL DEFAULT TRUE,   -- doctors require TOTP
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_clinic  ON staff(clinic_id);
CREATE INDEX idx_staff_user_id ON staff(user_id);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

-- Onboarding: new auth user inserts their own staff record
CREATE POLICY staff_insert_onboarding ON staff
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Self-read: works before JWT enrichment completes
CREATE POLICY staff_self_read ON staff
  FOR SELECT USING (user_id = auth.uid() AND is_active = TRUE);

-- Tenant: full access within clinic — fired staff lose access immediately
CREATE POLICY staff_tenant ON staff
  FOR ALL
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid AND is_active = TRUE)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid AND is_active = TRUE);

-- 2.3 staff_invites
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

-- 2.4 consent_templates
CREATE TABLE consent_templates (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id  UUID REFERENCES clinics(id) ON DELETE CASCADE, -- NULL = global default
  version    TEXT NOT NULL,
  language   TEXT NOT NULL DEFAULT 'en',
  content    TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
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

-- 2.5 patients
CREATE TABLE patients (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id          UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  dob                DATE,
  gender             TEXT CHECK (gender IN ('male','female','other','prefer_not_to_say')),
  mobile             TEXT NOT NULL,              -- NOT unique: families share phones
  address            TEXT,
  blood_group        TEXT,
  emergency_name     TEXT,
  emergency_phone    TEXT,
  preferred_language TEXT DEFAULT 'en',
  abha_id            TEXT,                       -- V2 hook: ABHA integration
  is_anonymized      BOOLEAN DEFAULT FALSE,
  anonymized_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_patients_mobile ON patients(clinic_id, mobile);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_tenant ON patients
  USING (
    clinic_id    = (auth.jwt() ->> 'clinic_id')::uuid
    AND is_anonymized = FALSE
  )
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 2.6 patient_consents
CREATE TABLE patient_consents (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID NOT NULL REFERENCES patients(id),
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  consent_text     TEXT NOT NULL,
  consent_version  TEXT NOT NULL,
  consented_at     TIMESTAMPTZ DEFAULT NOW(),
  ip_address       TEXT,
  captured_by      UUID REFERENCES staff(id),   -- NULL if self-served (V2 kiosk)
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

-- 2.7 sessions
CREATE TABLE sessions (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id                UUID NOT NULL REFERENCES clinics(id),
  doctor_id                UUID NOT NULL REFERENCES staff(id),
  date                     DATE NOT NULL DEFAULT CURRENT_DATE,
  status                   session_status DEFAULT 'open',
  opened_at                TIMESTAMPTZ DEFAULT NOW(),
  closed_at                TIMESTAMPTZ,
  avg_consultation_seconds INTEGER DEFAULT 300
);

CREATE INDEX idx_sessions_clinic ON sessions(clinic_id, date);
CREATE INDEX idx_sessions_doctor ON sessions(doctor_id, date);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant ON sessions
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- 2.8 session_counters (atomic token generation)
CREATE TABLE session_counters (
  session_id  UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  token_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE session_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY counters_tenant ON session_counters
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 2.9 queue_entries (core table)
CREATE TABLE queue_entries (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id               UUID NOT NULL REFERENCES clinics(id),
  session_id              UUID NOT NULL REFERENCES sessions(id),
  patient_id              UUID NOT NULL REFERENCES patients(id),
  token_number            INTEGER NOT NULL,
  token_prefix            TEXT DEFAULT 'A',
  type                    queue_type NOT NULL DEFAULT 'walk_in',
  source                  queue_source NOT NULL DEFAULT 'reception',
  status                  queue_status NOT NULL DEFAULT 'CHECKED_IN',
  version                 INTEGER NOT NULL DEFAULT 1,
  identity_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  notes                   TEXT,
  sync_status             sync_status NOT NULL DEFAULT 'synced', -- V2 offline hook
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  called_at               TIMESTAMPTZ,                -- set by DB trigger only
  consultation_started_at TIMESTAMPTZ,                -- set by DB trigger only
  completed_at            TIMESTAMPTZ,                -- set by DB trigger only
  UNIQUE (session_id, token_number)                   -- DB-level token uniqueness
);

CREATE INDEX idx_qe_session ON queue_entries(session_id);
CREATE INDEX idx_qe_clinic  ON queue_entries(clinic_id);
CREATE INDEX idx_qe_status  ON queue_entries(session_id, status);

ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY qe_tenant ON queue_entries
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;

-- 2.10 queue_display_sync (TV display — ZERO PII)
-- current_name deliberately excluded: first name = PII on a public screen
CREATE TABLE queue_display_sync (
  session_id     UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  current_token  TEXT,
  next_token     TEXT,
  queue_count    INTEGER NOT NULL DEFAULT 0,
  session_status TEXT NOT NULL DEFAULT 'open',
  clinic_name    TEXT,                           -- branding only, not PII
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE queue_display_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY display_read ON queue_display_sync
  FOR SELECT USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
-- No INSERT/UPDATE policy needed — sync_display() is SECURITY DEFINER

ALTER PUBLICATION supabase_realtime ADD TABLE queue_display_sync;

-- 2.11 payments (V1: cash/UPI flag only)
CREATE TABLE payments (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id           UUID NOT NULL REFERENCES clinics(id),
  queue_entry_id      UUID NOT NULL REFERENCES queue_entries(id),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  amount_paise        INTEGER NOT NULL DEFAULT 0,  -- always store in paise
  method              payment_mode NOT NULL DEFAULT 'cash',
  status              payment_status NOT NULL DEFAULT 'pending',
  collected_by        UUID REFERENCES staff(id),
  version             INTEGER NOT NULL DEFAULT 1,  -- OCC for concurrent marking
  -- V2 hooks (Razorpay):
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  paid_at             TIMESTAMPTZ
);

CREATE INDEX idx_payments_clinic         ON payments(clinic_id);
CREATE INDEX idx_payments_queue_entry_id ON payments(queue_entry_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON payments
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 2.12 master_drugs (global, read-only for clinics)
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

CREATE INDEX idx_drugs_name   ON master_drugs USING gin(name extensions.gin_trgm_ops);
CREATE INDEX idx_drugs_banned ON master_drugs(is_banned) WHERE is_banned = TRUE;

ALTER TABLE master_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY drugs_read ON master_drugs FOR SELECT USING (TRUE);

-- 2.13 doctor_drug_preferences
CREATE TABLE doctor_drug_preferences (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  doctor_id        UUID NOT NULL REFERENCES staff(id),
  drug_name        TEXT NOT NULL,
  generic_name     TEXT,
  category         TEXT,
  usage_count      INTEGER NOT NULL DEFAULT 1,
  default_dosage   TEXT,                         -- e.g. '1-0-1'
  default_duration INTEGER,                      -- days
  default_timing   TEXT,                         -- 'after_food', 'before_food'
  is_from_master   BOOLEAN DEFAULT TRUE,
  master_drug_id   UUID REFERENCES master_drugs(id),
  sync_status      sync_status DEFAULT 'synced',
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (doctor_id, drug_name)
);

CREATE INDEX idx_ddp_doctor ON doctor_drug_preferences(doctor_id);
CREATE INDEX idx_ddp_clinic ON doctor_drug_preferences(clinic_id);

ALTER TABLE doctor_drug_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ddp_tenant ON doctor_drug_preferences
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 2.14 custom_clinic_drugs
CREATE TABLE custom_clinic_drugs (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id          UUID NOT NULL REFERENCES clinics(id),
  doctor_id          UUID REFERENCES staff(id),
  drug_name          TEXT NOT NULL,
  usage_count        INTEGER DEFAULT 1,
  flagged_for_review BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_custom_clinic ON custom_clinic_drugs(clinic_id);

ALTER TABLE custom_clinic_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_drugs_tenant ON custom_clinic_drugs
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 2.15 drug_instructions_i18n
CREATE TABLE drug_instructions_i18n (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dosage_code TEXT NOT NULL,
  timing_code TEXT NOT NULL,
  language    TEXT NOT NULL,
  instruction TEXT NOT NULL,
  UNIQUE (dosage_code, timing_code, language)
);

ALTER TABLE drug_instructions_i18n ENABLE ROW LEVEL SECURITY;
CREATE POLICY i18n_read ON drug_instructions_i18n FOR SELECT USING (TRUE);

-- 2.16 audit_logs (append-only)
CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  clinic_id  UUID NOT NULL,
  staff_id   UUID,           -- from JWT claims — never NULL for staff actions
  action     TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id  UUID NOT NULL,
  old_value  JSONB,          -- PII columns excluded (name, mobile)
  new_value  JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_clinic ON audit_logs(clinic_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (TRUE);
CREATE POLICY audit_read   ON audit_logs FOR SELECT
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
-- No UPDATE or DELETE — append-only enforced by omission

-- 2.17 specialty_starter_packs
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

ALTER TABLE specialty_starter_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ssp_read ON specialty_starter_packs FOR SELECT USING (TRUE);

-- 2.18 queue_attachments
CREATE TABLE queue_attachments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id),
  patient_id     UUID NOT NULL REFERENCES patients(id),
  file_path      TEXT NOT NULL,
  file_type      TEXT NOT NULL DEFAULT 'prescription_scan',
  mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
  file_size      INTEGER,
  uploaded_by    UUID NOT NULL REFERENCES staff(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_clinic      ON queue_attachments(clinic_id);
CREATE INDEX idx_attachments_queue_entry ON queue_attachments(queue_entry_id);
CREATE INDEX idx_attachments_patient     ON queue_attachments(patient_id);

ALTER TABLE queue_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_tenant ON queue_attachments
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ─────────────────────────────────────────────────────────────
-- 3. V2 HOOK TABLES (schema only — zero application code)
-- ─────────────────────────────────────────────────────────────

-- 3.1 visits: full medical records (V2)
CREATE TABLE visits (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id         UUID NOT NULL REFERENCES clinics(id),
  patient_id        UUID NOT NULL REFERENCES patients(id),
  queue_entry_id    UUID REFERENCES queue_entries(id),
  doctor_id         UUID NOT NULL REFERENCES staff(id),
  visit_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  chief_complaint   TEXT,
  examination_notes TEXT,
  diagnosis         TEXT,
  icd10_code        TEXT,
  bp_systolic       INTEGER,
  bp_diastolic      INTEGER,
  pulse             INTEGER,
  temperature       NUMERIC(4,1),
  spo2              INTEGER,
  weight            NUMERIC(5,2),
  height            NUMERIC(5,2),
  follow_up_date    DATE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY visits_tenant ON visits
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 3.2 appointments: booking system (V2)
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

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_tenant ON appointments
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- 3.3 analytics_events: anonymised feed (V2 — no PII, no clinic_id)
CREATE TABLE analytics_events (
  id         BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  icd10_code TEXT,
  drug_name  TEXT,
  pin_code   TEXT,
  specialty  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_insert ON analytics_events
  FOR INSERT WITH CHECK (TRUE);
-- No SELECT — internal V2 use only

-- 3.4 kiosk_checkins: OTP kiosk flow (V2)
CREATE TABLE kiosk_checkins (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  mobile      TEXT NOT NULL,
  otp_hash    TEXT,
  verified_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kiosk_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY kiosk_tenant ON kiosk_checkins
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

-- ─────────────────────────────────────────────────────────────
-- 4. FUNCTIONS
-- All: SECURITY DEFINER + SET search_path = public
-- ─────────────────────────────────────────────────────────────

-- 4.1 set_queue_timestamps — BEFORE UPDATE trigger
CREATE OR REPLACE FUNCTION public.set_queue_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- 4.2 log_queue_change — AFTER UPDATE trigger (audit)
-- Reads staff_id from JWT claims — no extra DB lookup per CLAUDE.md rule #6
CREATE OR REPLACE FUNCTION public.log_queue_change()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- 4.3 sync_display — AFTER UPDATE trigger (TV display)
-- FIX: SECURITY DEFINER so it can write to queue_display_sync (no direct RLS policy needed)
-- FIX: Removed patients JOIN — current_name is PII, not shown on TV screen
CREATE OR REPLACE FUNCTION public.sync_display()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current_token  TEXT;
  v_next_token     TEXT;
  v_queue_count    INTEGER;
  v_session_status TEXT;
  v_clinic_name    TEXT;
BEGIN
  SELECT qe.token_prefix || '-' || qe.token_number
  INTO v_current_token
  FROM queue_entries qe
  WHERE qe.session_id = NEW.session_id AND qe.status = 'CALLED'
  ORDER BY qe.called_at DESC LIMIT 1;

  SELECT token_prefix || '-' || token_number
  INTO v_next_token
  FROM queue_entries
  WHERE session_id = NEW.session_id AND status = 'CHECKED_IN'
  ORDER BY created_at ASC LIMIT 1;

  SELECT COUNT(*)
  INTO v_queue_count
  FROM queue_entries
  WHERE session_id = NEW.session_id AND status IN ('CHECKED_IN', 'CALLED');

  SELECT s.status::TEXT, c.name
  INTO v_session_status, v_clinic_name
  FROM sessions s JOIN clinics c ON c.id = s.clinic_id
  WHERE s.id = NEW.session_id;

  INSERT INTO queue_display_sync(
    session_id, clinic_id,
    current_token, next_token, queue_count, session_status, clinic_name,
    updated_at
  )
  VALUES (
    NEW.session_id, NEW.clinic_id,
    v_current_token, v_next_token,
    COALESCE(v_queue_count, 0),
    COALESCE(v_session_status, 'open'),
    COALESCE(v_clinic_name, ''),
    NOW()
  )
  ON CONFLICT (session_id) DO UPDATE SET
    current_token  = EXCLUDED.current_token,
    next_token     = EXCLUDED.next_token,
    queue_count    = EXCLUDED.queue_count,
    session_status = EXCLUDED.session_status,
    clinic_name    = EXCLUDED.clinic_name,
    updated_at     = NOW();

  RETURN NEW;
END;
$$;

-- 4.4 update_avg_consultation — AFTER UPDATE trigger
CREATE OR REPLACE FUNCTION public.update_avg_consultation()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- 4.5 increment_session_token — atomic token generation
CREATE OR REPLACE FUNCTION public.increment_session_token(p_session_id UUID)
RETURNS INTEGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- 4.6 open_session — creates session + counter atomically
CREATE OR REPLACE FUNCTION public.open_session(p_clinic_id UUID, p_doctor_id UUID)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  INSERT INTO sessions(clinic_id, doctor_id, date, status)
  VALUES (p_clinic_id, p_doctor_id, CURRENT_DATE, 'open')
  RETURNING id INTO v_session_id;

  INSERT INTO session_counters(session_id, clinic_id, token_count)
  VALUES (v_session_id, p_clinic_id, 0);

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$$;

-- 4.7 create_patient_with_consent — atomic: patient + consent + queue entry
CREATE OR REPLACE FUNCTION public.create_patient_with_consent(
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
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_patient_id UUID;
  v_token      INTEGER;
  v_entry_id   UUID;
BEGIN
  INSERT INTO patients(clinic_id, name, mobile, dob, gender, preferred_language)
  VALUES (p_clinic_id, p_name, p_mobile, p_dob, p_gender, p_preferred_lang)
  RETURNING id INTO v_patient_id;

  INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version, captured_by)
  VALUES (v_patient_id, p_clinic_id, p_consent_text, p_consent_version, p_captured_by);

  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, source)
  VALUES (p_clinic_id, p_session_id, v_patient_id, v_token, 'reception')
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'patient_id',     v_patient_id,
    'queue_entry_id', v_entry_id,
    'token_number',   v_token
  );
END;
$$;

-- 4.8 add_patient_to_queue — existing patient → queue (with consent re-check)
CREATE OR REPLACE FUNCTION public.add_patient_to_queue(
  p_clinic_id       UUID,
  p_patient_id      UUID,
  p_session_id      UUID,
  p_consent_text    TEXT,
  p_consent_version TEXT,
  p_captured_by     UUID
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token            INTEGER;
  v_entry_id         UUID;
  v_existing_consent UUID;
BEGIN
  SELECT id INTO v_existing_consent
  FROM patient_consents
  WHERE patient_id      = p_patient_id
    AND clinic_id       = p_clinic_id
    AND consent_version = p_consent_version
    AND is_withdrawn    = FALSE
  LIMIT 1;

  IF v_existing_consent IS NULL THEN
    INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version, captured_by)
    VALUES (p_patient_id, p_clinic_id, p_consent_text, p_consent_version, p_captured_by);
  END IF;

  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, source)
  VALUES (p_clinic_id, p_session_id, p_patient_id, v_token, 'reception')
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'queue_entry_id', v_entry_id,
    'token_number',   v_token
  );
END;
$$;

-- 4.9 start_rapid_consultation — solo doctor rapid mode
-- FIX: jsonb_agg (was json_agg — caused jsonb_array_length type error)
CREATE OR REPLACE FUNCTION public.start_rapid_consultation(
  p_clinic_id  UUID,
  p_doctor_id  UUID,
  p_session_id UUID,
  p_mobile     TEXT,
  p_name       TEXT,
  p_patient_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_patient_id     UUID;
  v_token          INTEGER;
  v_entry_id       UUID;
  v_family_members JSONB;
  v_consent_version TEXT;
  v_consent_text    TEXT;
BEGIN
  IF p_patient_id IS NOT NULL THEN
    v_patient_id := p_patient_id;
  ELSE
    SELECT id INTO v_patient_id
    FROM patients
    WHERE clinic_id = p_clinic_id AND mobile = p_mobile AND is_anonymized = FALSE
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT config->>'consent_version' INTO v_consent_version
      FROM clinics WHERE id = p_clinic_id;

      SELECT content INTO v_consent_text
      FROM consent_templates
      WHERE (clinic_id = p_clinic_id OR clinic_id IS NULL)
        AND version  = COALESCE(v_consent_version, 'v1.0')
        AND language = 'en'
        AND is_active = TRUE
      ORDER BY clinic_id NULLS LAST LIMIT 1;

      INSERT INTO patients(clinic_id, name, mobile)
      VALUES (p_clinic_id, p_name, p_mobile)
      RETURNING id INTO v_patient_id;

      INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version, captured_by)
      VALUES (v_patient_id, p_clinic_id,
              COALESCE(v_consent_text, ''),
              COALESCE(v_consent_version, 'v1.0'),
              p_doctor_id);
    ELSE
      SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'dob', dob))
      INTO v_family_members
      FROM patients
      WHERE clinic_id = p_clinic_id AND mobile = p_mobile AND is_anonymized = FALSE;

      IF jsonb_array_length(v_family_members) > 1 THEN
        RETURN jsonb_build_object(
          'queue_entry_id', NULL,
          'patient_id',     NULL,
          'family_members', v_family_members
        );
      END IF;
    END IF;
  END IF;

  UPDATE session_counters
  SET token_count = token_count + 1
  WHERE session_id = p_session_id
  RETURNING token_count INTO v_token;

  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, source, identity_verified)
  VALUES (p_clinic_id, p_session_id, v_patient_id, v_token, 'doctor_rapid', TRUE)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'queue_entry_id', v_entry_id,
    'patient_id',     v_patient_id,
    'family_members', NULL
  );
END;
$$;

-- 4.10 get_session_z_report — end-of-day Z-report
CREATE OR REPLACE FUNCTION public.get_session_z_report(p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- 4.11 export_patient_data — DPDP Section 11
CREATE OR REPLACE FUNCTION public.export_patient_data(p_patient_id UUID)
RETURNS JSONB LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'patient',       row_to_json(p.*),
      'consents',      COALESCE(jsonb_agg(DISTINCT pc.*), '[]'::jsonb),
      'queue_history', COALESCE(jsonb_agg(DISTINCT qe.*), '[]'::jsonb)
    )
    FROM patients p
    LEFT JOIN patient_consents pc ON pc.patient_id = p.id
    LEFT JOIN queue_entries    qe ON qe.patient_id = p.id
    WHERE p.id = p_patient_id
    GROUP BY p.id
  );
END;
$$;

-- 4.12 anonymize_patient — DPDP erasure (Section 12)
-- Uses extensions.digest to avoid search_path pgcrypto dependency
CREATE OR REPLACE FUNCTION public.anonymize_patient(p_patient_id UUID, p_clinic_id UUID)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
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
$$;

-- 4.13 seed_doctor_drug_batch — load specialty starter pack
CREATE OR REPLACE FUNCTION public.seed_doctor_drug_batch(
  p_doctor_id UUID,
  p_clinic_id UUID,
  p_specialty TEXT
)
RETURNS VOID LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- 4.14 create_onboarding_clinic — SECURITY DEFINER to bypass RLS during onboarding
-- FIX: Removed full_name column reference
CREATE OR REPLACE FUNCTION public.create_onboarding_clinic(
  p_clinic_name   TEXT,
  p_address       TEXT,
  p_phone         TEXT,
  p_primary_color TEXT    DEFAULT '#0891b2',
  p_pin_code      TEXT    DEFAULT NULL,
  p_state         TEXT    DEFAULT NULL,
  p_doctor_name   TEXT    DEFAULT '',
  p_email         TEXT    DEFAULT '',
  p_reg_number    TEXT    DEFAULT '',
  p_qualification TEXT    DEFAULT '',
  p_specialty     TEXT    DEFAULT ''
)
RETURNS JSON LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_clinic_id UUID;
  v_staff_id  UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent: if user already onboarded, return existing record
  SELECT s.id, s.clinic_id INTO v_staff_id, v_clinic_id
  FROM staff s WHERE s.user_id = v_user_id AND s.is_active = TRUE
  LIMIT 1;

  IF v_staff_id IS NOT NULL THEN
    RETURN json_build_object(
      'clinic_id',       v_clinic_id,
      'staff_id',        v_staff_id,
      'already_existed', true
    );
  END IF;

  INSERT INTO clinics(name, address, phone, primary_color, clinic_pin_code, state)
  VALUES (p_clinic_name, p_address, p_phone, p_primary_color, p_pin_code, p_state)
  RETURNING id INTO v_clinic_id;

  -- Founding doctor: totp_required=FALSE (set to TRUE after TOTP setup)
  INSERT INTO staff(clinic_id, user_id, name, email, role, is_active, totp_required, reg_number, qualification, specialty)
  VALUES (v_clinic_id, v_user_id, p_doctor_name, p_email, 'doctor', TRUE, FALSE, p_reg_number, p_qualification, p_specialty)
  RETURNING id INTO v_staff_id;

  RETURN json_build_object(
    'clinic_id',       v_clinic_id,
    'staff_id',        v_staff_id,
    'already_existed', false
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. TRIGGERS
-- ─────────────────────────────────────────────────────────────

-- Timestamp trigger: DB sets called_at, consultation_started_at, completed_at
CREATE TRIGGER trg_queue_timestamps
  BEFORE UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION set_queue_timestamps();

-- Audit trigger: logs every queue status change with staff_id from JWT
CREATE TRIGGER trg_queue_audit
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION log_queue_change();

-- Display sync trigger: keeps TV display table up to date (zero PII)
CREATE TRIGGER trg_display_sync
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION sync_display();

-- Avg consultation time: recalculates on each COMPLETED transition
CREATE TRIGGER trg_avg_consultation
  AFTER UPDATE ON queue_entries
  FOR EACH ROW EXECUTE FUNCTION update_avg_consultation();
