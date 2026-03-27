// supabase/functions/jwt-enrichment/index.ts
// Supabase Auth Hook — fires on every login.
// Injects clinic_id, staff_id, role into the JWT.
// These claims are used by EVERY RLS policy for tenant isolation.
// NEVER returns PII (name, email, mobile) in the JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  try {
    const { user_id } = await req.json()

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing user_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: staffRecord } = await supabase
      .from('staff')
      .select('id, clinic_id, role, is_active, totp_required')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single()

    // No staff record = new user still in onboarding, or deactivated staff.
    // Return empty claims — AuthCallback routes them to /setup.
    // ProtectedRoute blocks portal access if role is absent.
    if (!staffRecord) {
      // No staff record = new user in onboarding.
      // Return empty claims object — AuthCallback routes them to /setup.
      return new Response(
        JSON.stringify({ claims: {} }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Return only what RLS policies need — no PII in JWT.
    // totp_required defaults to true if column not yet present (safe fallback).
    return new Response(
      JSON.stringify({
        claims: {
          clinic_id:     staffRecord.clinic_id,
          staff_id:      staffRecord.id,
          role:          staffRecord.role,
          totp_required: staffRecord.totp_required ?? true,
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[jwt-enrichment] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error during JWT enrichment.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
