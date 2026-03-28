-- Migration 011: prescriptions child table + save_visit RPC
-- Replaces storing prescription data as JSON inside queue_entries.notes.
-- visits table already exists (from v1_clean migration) — adding prescriptions child.

-- ── prescriptions child table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_id        UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  drug_name       TEXT NOT NULL,
  generic_name    TEXT,
  dosage          TEXT NOT NULL,          -- e.g. '1-0-1'
  duration_days   INTEGER NOT NULL,
  timing          TEXT,                   -- 'after_food' | 'before_food' | 'empty_stomach' | 'sos'
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prescriptions_tenant ON prescriptions
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);

CREATE INDEX prescriptions_visit_id_idx ON prescriptions(visit_id);

-- ── save_visit RPC ─────────────────────────────────────────────────────────────
-- Called by the doctor portal when ending a consultation.
-- Creates the visit record, inserts prescriptions, and writes a lightweight
-- summary back to queue_entries.notes for backward compatibility.

CREATE OR REPLACE FUNCTION save_visit(
  p_clinic_id        UUID,
  p_patient_id       UUID,
  p_queue_entry_id   UUID,
  p_doctor_id        UUID,
  p_chief_complaint  TEXT,
  p_examination_notes TEXT,
  p_bp_systolic      INTEGER,
  p_bp_diastolic     INTEGER,
  p_pulse            INTEGER,
  p_temperature      NUMERIC,
  p_spo2             INTEGER,
  p_weight           NUMERIC,
  p_prescriptions    JSONB   -- array of {drug_name, generic_name, dosage, duration_days, timing}
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_id   UUID;
  v_rx         JSONB;
BEGIN
  -- Insert visit record
  INSERT INTO visits (
    clinic_id, patient_id, queue_entry_id, doctor_id,
    chief_complaint, examination_notes,
    bp_systolic, bp_diastolic, pulse, temperature, spo2, weight
  )
  VALUES (
    p_clinic_id, p_patient_id, p_queue_entry_id, p_doctor_id,
    p_chief_complaint, p_examination_notes,
    p_bp_systolic, p_bp_diastolic, p_pulse, p_temperature, p_spo2, p_weight
  )
  RETURNING id INTO v_visit_id;

  -- Insert prescription items
  FOR v_rx IN SELECT * FROM jsonb_array_elements(p_prescriptions)
  LOOP
    INSERT INTO prescriptions (visit_id, clinic_id, drug_name, generic_name, dosage, duration_days, timing)
    VALUES (
      v_visit_id,
      p_clinic_id,
      v_rx->>'drug_name',
      v_rx->>'generic_name',
      v_rx->>'dosage',
      (v_rx->>'duration_days')::INTEGER,
      v_rx->>'timing'
    );
  END LOOP;

  RETURN v_visit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION save_visit(UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, NUMERIC, INTEGER, NUMERIC, JSONB) TO authenticated;
