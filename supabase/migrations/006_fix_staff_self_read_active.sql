-- Fix staff_self_read policy to enforce is_active = TRUE
-- CLAUDE.md rule 1: every staff RLS policy must include AND is_active = TRUE
-- Without this, inactive staff could still SELECT their own row via the self-read policy

DROP POLICY IF EXISTS staff_self_read ON staff;

CREATE POLICY staff_self_read ON staff
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND is_active = TRUE);
