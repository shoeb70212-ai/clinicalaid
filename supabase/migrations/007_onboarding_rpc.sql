-- Onboarding RPC: creates clinic + staff in one atomic call.
-- SECURITY DEFINER bypasses RLS (necessary because JWT has no clinic_id yet).
-- Only creates staff if caller has no existing active staff record (idempotent guard).

CREATE OR REPLACE FUNCTION create_onboarding_clinic(
  p_clinic_name     TEXT,
  p_address         TEXT,
  p_phone           TEXT,
  p_primary_color   TEXT DEFAULT '#0891b2',
  p_pin_code        TEXT DEFAULT NULL,
  p_state           TEXT DEFAULT NULL,
  p_doctor_name     TEXT DEFAULT '',
  p_email           TEXT DEFAULT '',
  p_reg_number      TEXT DEFAULT '',
  p_qualification   TEXT DEFAULT '',
  p_specialty       TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_clinic_id  UUID;
  v_staff_id   UUID;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent guard: if user already has an active staff record, return it
  SELECT s.id, s.clinic_id INTO v_staff_id, v_clinic_id
  FROM staff s WHERE s.user_id = v_user_id AND s.is_active = TRUE
  LIMIT 1;

  IF v_staff_id IS NOT NULL THEN
    RETURN json_build_object(
      'clinic_id', v_clinic_id,
      'staff_id', v_staff_id,
      'already_existed', true
    );
  END IF;

  -- Create clinic
  INSERT INTO clinics (name, address, phone, primary_color, clinic_pin_code, state)
  VALUES (p_clinic_name, p_address, p_phone, p_primary_color, p_pin_code, p_state)
  RETURNING id INTO v_clinic_id;

  -- Create staff record for the founding doctor
  INSERT INTO staff (clinic_id, user_id, name, full_name, email, role, is_active, totp_required, reg_number, qualification, specialty)
  VALUES (v_clinic_id, v_user_id, p_doctor_name, p_doctor_name, p_email, 'doctor', TRUE, FALSE, p_reg_number, p_qualification, p_specialty)
  RETURNING id INTO v_staff_id;

  RETURN json_build_object(
    'clinic_id', v_clinic_id,
    'staff_id', v_staff_id,
    'already_existed', false
  );
END;
$$;
