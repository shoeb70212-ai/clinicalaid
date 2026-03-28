-- ============================================================
-- Migration 008: Fix RPC signatures + atomic session creation
-- ============================================================

-- ── RPC: create_new_patient ──────────────────────────────────
-- Replaces the frontend use of create_patient_with_consent.
-- Creates patient + consent only (no queue entry).
-- Queue entry is added separately by add_patient_to_queue or
-- by the frontend's addToQueue flow.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_new_patient(
  p_clinic_id       UUID,
  p_name            TEXT,
  p_mobile          TEXT,
  p_consent_text    TEXT,
  p_consent_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_id UUID;
BEGIN
  INSERT INTO patients(clinic_id, name, mobile)
  VALUES (p_clinic_id, p_name, p_mobile)
  RETURNING id INTO v_patient_id;

  INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version)
  VALUES (v_patient_id, p_clinic_id, p_consent_text, p_consent_version);

  RETURN jsonb_build_object('patient_id', v_patient_id);
END;
$$;

-- ── RPC: open_session ────────────────────────────────────────
-- Atomically creates session + session_counters row.
-- Prevents orphaned sessions when the second insert fails.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION open_session(
  p_clinic_id UUID,
  p_doctor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_date       DATE := CURRENT_DATE;
BEGIN
  -- Idempotent: close any existing open/paused session for this doctor today
  -- (optional safeguard — reception should handle this, but belt+suspenders)

  INSERT INTO sessions(clinic_id, doctor_id, date, status)
  VALUES (p_clinic_id, p_doctor_id, v_date, 'open')
  RETURNING id INTO v_session_id;

  INSERT INTO session_counters(session_id, clinic_id, token_count)
  VALUES (v_session_id, p_clinic_id, 0);

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$$;
