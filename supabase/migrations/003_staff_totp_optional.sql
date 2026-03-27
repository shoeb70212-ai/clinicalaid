-- ============================================================
-- ClinicFlow — Optional TOTP per staff member
-- Default TRUE keeps existing security posture for all doctors.
-- Admin can set to FALSE per staff member in clinic settings.
-- This enables Google/Apple OAuth-only login for low-risk roles.
-- ============================================================

ALTER TABLE staff ADD COLUMN totp_required BOOLEAN NOT NULL DEFAULT TRUE;

-- Receptionists default to FALSE (lower risk role)
UPDATE staff SET totp_required = FALSE WHERE role = 'receptionist';

-- Doctors and admins stay TRUE (access to full patient records)
-- No update needed — DEFAULT TRUE already applies
