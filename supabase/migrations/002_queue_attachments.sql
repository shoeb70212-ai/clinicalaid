-- ============================================================
-- ClinicFlow — Queue Attachments
-- Paper prescription scans + lab report images.
-- Images are captured on device, compressed, uploaded to
-- Supabase Storage. NO client-side OCR parsing — visual
-- record only. V2 will add server-side cloud OCR.
-- Storage path: {clinicId}/prescriptions/{queueEntryId}/{uuid}.jpg
-- ============================================================

CREATE TABLE queue_attachments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients(id),
  file_path      TEXT NOT NULL,              -- Supabase Storage path
  file_type      TEXT NOT NULL DEFAULT 'prescription_scan',
                                             -- 'prescription_scan' | 'lab_report' | 'other'
  mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
  file_size      INTEGER,                    -- bytes (post-compression)
  uploaded_by    UUID NOT NULL REFERENCES staff(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_queue_entry ON queue_attachments(queue_entry_id);
CREATE INDEX idx_attachments_clinic      ON queue_attachments(clinic_id);
CREATE INDEX idx_attachments_patient     ON queue_attachments(patient_id);

ALTER TABLE queue_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY attachments_tenant ON queue_attachments
  USING  (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid);
