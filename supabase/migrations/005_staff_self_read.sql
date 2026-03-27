-- Allow users to read their own staff record by user_id
-- This is needed for AuthCallback to work after OAuth login
-- before JWT enrichment adds clinic_id

CREATE POLICY staff_self_read ON staff
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());