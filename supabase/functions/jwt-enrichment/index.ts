// supabase/functions/jwt-enrichment/index.ts
// Supabase Auth Hook — fires on every login.
// Injects clinic_id, staff_id, role into the JWT.
// These claims are used by EVERY RLS policy for tenant isolation.
// NEVER returns PII (name, email, mobile) in the JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  try {
    // Supabase sends the full claims object + user_id in the request body.
    // We must return ALL standard claims plus our custom fields.
    const body = await req.json()
    const { user_id, claims } = body

    if (!user_id || !claims) {
      return new Response(
        JSON.stringify({ error: 'Missing user_id or claims' }),
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

    // Spread the incoming standard claims, then add our custom fields.
    // For new users with no staff record, return standard claims unchanged —
    // AuthCallback will route them to /setup; ProtectedRoute blocks portal access.
    return new Response(
      JSON.stringify({
        claims: {
          ...claims,
          ...(staffRecord ? {
            clinic_id:     staffRecord.clinic_id,
            staff_id:      staffRecord.id,
            app_role:      staffRecord.role,
            totp_required: staffRecord.totp_required ?? true,
          } : {}),
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
