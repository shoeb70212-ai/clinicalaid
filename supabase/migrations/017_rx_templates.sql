-- ── Migration 017: Rx Templates ──────────────────────────────────────────────
-- Doctors can save prescription sets as named templates for rapid reuse.

CREATE TABLE IF NOT EXISTS rx_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id   uuid        NOT NULL REFERENCES staff(id)   ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  items       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rx_templates_doctor_idx ON rx_templates (clinic_id, doctor_id);

ALTER TABLE rx_templates ENABLE ROW LEVEL SECURITY;

-- Doctors may only see and manage their own templates within the same clinic
CREATE POLICY "rx_templates_doctor_own" ON rx_templates
  FOR ALL
  USING (
    clinic_id = (SELECT clinic_id FROM staff WHERE user_id = auth.uid() AND is_active = TRUE)
    AND doctor_id = (SELECT id FROM staff WHERE user_id = auth.uid() AND is_active = TRUE)
  )
  WITH CHECK (
    clinic_id = (SELECT clinic_id FROM staff WHERE user_id = auth.uid() AND is_active = TRUE)
    AND doctor_id = (SELECT id FROM staff WHERE user_id = auth.uid() AND is_active = TRUE)
  );
