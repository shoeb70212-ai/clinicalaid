import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { LoadingSpinner } from './LoadingSpinner'

/**
 * OAuth redirect landing page.
 * Supabase redirects here after Google consent with a `code` param.
 * We exchange it for a session, then route by role — same logic as LoginPage.
 * Route: /auth/callback
 */
async function routeBySession(session: { user: { id: string } }, navigate: (path: string, opts?: { replace: boolean }) => void) {
  console.log('[AuthCallback] routeBySession started, user:', session.user.id)

  // Query staff table directly using the user's ID
  const { data: staffRecord, error: staffError } = await supabase
    .from('staff')
    .select('id, clinic_id, role, is_active, totp_required')
    .eq('user_id', session.user.id)
    .eq('is_active', true)
    .single()

  console.log('[AuthCallback] Staff query result:', { 
    hasData: !!staffRecord, 
    error: staffError?.message,
    role: staffRecord?.role 
  })

  if (!staffRecord) {
    // No staff record = new user going to onboarding
    console.log('[AuthCallback] No staff record - routing to /setup')
    navigate('/setup', { replace: true })
    return
  }

  console.log('[AuthCallback] Staff found, role:', staffRecord.role)

  // Check MFA requirement
  const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const needsMfa =
    staffRecord.totp_required !== false &&
    mfaData?.nextLevel === 'aal2' &&
    mfaData?.currentLevel !== 'aal2'

  if (needsMfa) { 
    navigate('/verify-mfa', { replace: true }); 
    return 
  }

  // Route by role
  if (staffRecord.role === 'doctor' || staffRecord.role === 'admin') {
    navigate('/doctor', { replace: true })
  } else if (staffRecord.role === 'receptionist') {
    navigate('/reception', { replace: true })
  } else {
    navigate('/setup', { replace: true })
  }
}

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    console.log('[AuthCallback] mounted, url:', window.location.href)

    // Small delay to ensure session is fully established
    setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        console.log('[AuthCallback] getSession result:', session ? 'HAS SESSION' : 'NO SESSION', session?.user?.id)
        
        if (session) { 
          routeBySession(session, navigate); 
          return 
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          console.log('[AuthCallback] onAuthStateChange event:', event, session?.user?.id)
          if (event === 'SIGNED_IN' && session) {
            subscription.unsubscribe()
            routeBySession(session, navigate)
          }
        })

        const timeout = setTimeout(() => {
          console.log('[AuthCallback] TIMEOUT — no session after 10s, redirecting to login')
          subscription.unsubscribe()
          navigate('/login', { replace: true })
        }, 10000)

        return () => { clearTimeout(timeout); subscription.unsubscribe() }
      })
    }, 500) // 500ms delay to ensure session is ready
  }, [navigate])

  return <LoadingSpinner fullScreen />
}
