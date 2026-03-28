-- ============================================================
-- Migration 016: Add optional demographics to create_new_patient RPC
-- Adds p_dob, p_gender, p_blood_group as optional parameters (DEFAULT NULL)
-- so existing callers are unaffected.
-- ============================================================

CREATE OR REPLACE FUNCTION create_new_patient(
  p_clinic_id       UUID,
  p_name            TEXT,
  p_mobile          TEXT,
  p_consent_text    TEXT,
  p_consent_version TEXT,
  p_dob             DATE DEFAULT NULL,
  p_gender          TEXT DEFAULT NULL,
  p_blood_group     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_id UUID;
BEGIN
  INSERT INTO patients(clinic_id, name, mobile, dob, gender, blood_group)
  VALUES (p_clinic_id, p_name, p_mobile, p_dob, p_gender, p_blood_group)
  RETURNING id INTO v_patient_id;

  INSERT INTO patient_consents(patient_id, clinic_id, consent_text, consent_version)
  VALUES (v_patient_id, p_clinic_id, p_consent_text, p_consent_version);

  RETURN jsonb_build_object('patient_id', v_patient_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_new_patient(UUID, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) TO authenticated;
