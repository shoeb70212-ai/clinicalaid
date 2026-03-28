-- Migration 015: add_to_queue RPC — used by RecallPanel to re-queue a patient.
-- Atomically grabs next token, inserts queue entry, returns its id.

CREATE OR REPLACE FUNCTION add_to_queue(
  p_session_id UUID,
  p_clinic_id  UUID,
  p_patient_id UUID,
  p_type       TEXT    DEFAULT 'walk_in',
  p_source     TEXT    DEFAULT 'reception',
  p_notes      TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token    INTEGER;
  v_entry_id UUID;
BEGIN
  -- Atomic token grab
  UPDATE session_counters
  SET    token_count = token_count + 1
  WHERE  session_id = p_session_id
    AND  clinic_id  = p_clinic_id
  RETURNING token_count INTO v_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session counter not found for session %', p_session_id;
  END IF;

  INSERT INTO queue_entries(clinic_id, session_id, patient_id, token_number, type, source, notes)
  VALUES (p_clinic_id, p_session_id, p_patient_id, v_token, p_type::queue_type, p_source::queue_source, p_notes)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'queue_entry_id', v_entry_id,
    'token_number',   v_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION add_to_queue(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;
