-- Migration 010: increment_drug_usage RPC
-- Properly upserts a doctor drug preference with usage_count increment.
-- Replaces the broken upsert in the frontend that reset usage_count to 1 on every call.

CREATE OR REPLACE FUNCTION increment_drug_usage(
  p_clinic_id        UUID,
  p_doctor_id        UUID,
  p_drug_name        TEXT,
  p_dosage           TEXT,
  p_duration         INTEGER,
  p_timing           TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO doctor_drug_preferences (
    clinic_id,
    doctor_id,
    drug_name,
    usage_count,
    default_dosage,
    default_duration,
    default_timing,
    sync_status,
    updated_at
  )
  VALUES (
    p_clinic_id,
    p_doctor_id,
    p_drug_name,
    1,
    p_dosage,
    p_duration,
    p_timing,
    'synced',
    NOW()
  )
  ON CONFLICT (doctor_id, drug_name) DO UPDATE
    SET usage_count      = doctor_drug_preferences.usage_count + 1,
        default_dosage   = EXCLUDED.default_dosage,
        default_duration = EXCLUDED.default_duration,
        default_timing   = EXCLUDED.default_timing,
        sync_status      = 'synced',
        updated_at       = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION increment_drug_usage(UUID, UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
