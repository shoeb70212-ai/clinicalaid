-- F2: Add is_active = TRUE to staff RLS WITH CHECK clause
-- Deactivated staff must not be able to INSERT or UPDATE staff rows
-- even if their JWT hasn't expired yet.

DROP POLICY IF EXISTS staff_tenant ON staff;

CREATE POLICY staff_tenant ON staff
  USING (
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
    AND is_active = TRUE
  )
  WITH CHECK (
    clinic_id = (auth.jwt() ->> 'clinic_id')::uuid
    AND is_active = TRUE
  );
