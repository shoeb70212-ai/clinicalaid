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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseKey) {
      console.error('[jwt-enrichment] Missing env vars - check Supabase secrets')
      return new Response(
        JSON.stringify({}),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: staffRecord, error: staffError } = await supabase
      .from('staff')
      .select('id, clinic_id, role, is_active, totp_required')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single()

    if (staffError) {
      console.error('[jwt-enrichment] Staff query error:', staffError.message)
    }

    if (!staffRecord) {
      console.log('[jwt-enrichment] No staff record for user:', user_id, '- new user going to onboarding')
    }

    // Return claims at ROOT level, not wrapped in "claims" object.
    // Supabase merges these directly into app_metadata.
    const customClaims = staffRecord ? {
      clinic_id:     staffRecord.clinic_id,
      staff_id:      staffRecord.id,
      app_role:      staffRecord.role,
      totp_required: staffRecord.totp_required ?? true,
    } : {}

    console.log('[jwt-enrichment] Returning claims:', Object.keys(customClaims))

    return new Response(
      JSON.stringify(customClaims),
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
