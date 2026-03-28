-- Migration 009: consume_invite RPC
-- Validates a staff invite token, creates the staff record, and marks the invite as used.
-- Called by the frontend invite signup flow after supabase.auth.signUp succeeds.

CREATE OR REPLACE FUNCTION consume_invite(
  p_token    TEXT,
  p_user_id  UUID,
  p_name     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite    staff_invites%ROWTYPE;
  v_staff_id  UUID;
BEGIN
  -- Lock the invite row to prevent race conditions on concurrent calls
  SELECT * INTO v_invite
  FROM staff_invites
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite token';
  END IF;

  IF v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invite has already been used';
  END IF;

  IF v_invite.expires_at < NOW() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  -- Create the staff record linked to the new auth user
  INSERT INTO staff (clinic_id, user_id, name, email, role, is_active, totp_required)
  VALUES (v_invite.clinic_id, p_user_id, p_name, v_invite.email, v_invite.role, TRUE, FALSE)
  RETURNING id INTO v_staff_id;

  -- Mark invite as consumed
  UPDATE staff_invites SET used_at = NOW() WHERE token = p_token;

  RETURN jsonb_build_object(
    'staff_id',   v_staff_id,
    'clinic_id',  v_invite.clinic_id,
    'role',       v_invite.role
  );
END;
$$;

-- Allow the anon role to call this function (needed for invite signup before auth)
GRANT EXECUTE ON FUNCTION consume_invite(TEXT, UUID, TEXT) TO anon, authenticated;
