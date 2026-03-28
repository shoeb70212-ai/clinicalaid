-- Migration 012: Extend appointments table for booking UX
-- Adds useful columns for reception + doctor calendar.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS notes          TEXT,
  ADD COLUMN IF NOT EXISTS appointment_type TEXT DEFAULT 'regular',  -- 'regular' | 'follow_up' | 'urgent'
  ADD COLUMN IF NOT EXISTS duration_mins  INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();

-- Index for calendar queries (clinic + date range)
CREATE INDEX IF NOT EXISTS appointments_clinic_date_idx
  ON appointments(clinic_id, scheduled_at);

-- Index for patient history
CREATE INDEX IF NOT EXISTS appointments_patient_idx
  ON appointments(patient_id, scheduled_at DESC);

-- book_appointment RPC — validates no double-booking, creates appointment
CREATE OR REPLACE FUNCTION book_appointment(
  p_clinic_id        UUID,
  p_patient_id       UUID,
  p_doctor_id        UUID,
  p_scheduled_at     TIMESTAMPTZ,
  p_duration_mins    INTEGER,
  p_appointment_type TEXT,
  p_notes            TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Check for overlapping appointment for same doctor
  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE doctor_id = p_doctor_id
      AND status NOT IN ('cancelled', 'no_show')
      AND scheduled_at < p_scheduled_at + (p_duration_mins || ' minutes')::interval
      AND scheduled_at + (duration_mins || ' minutes')::interval > p_scheduled_at
  ) THEN
    RAISE EXCEPTION 'Time slot already booked for this doctor';
  END IF;

  INSERT INTO appointments (
    clinic_id, patient_id, doctor_id,
    scheduled_at, duration_mins, appointment_type, notes, status
  )
  VALUES (
    p_clinic_id, p_patient_id, p_doctor_id,
    p_scheduled_at, p_duration_mins, p_appointment_type, p_notes, 'booked'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION book_appointment(UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT) TO authenticated;

-- cancel_appointment RPC
CREATE OR REPLACE FUNCTION cancel_appointment(
  p_appointment_id UUID,
  p_clinic_id      UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE appointments
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_appointment_id
    AND clinic_id = p_clinic_id
    AND status = 'booked';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found or already cancelled';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_appointment(UUID, UUID) TO authenticated;
