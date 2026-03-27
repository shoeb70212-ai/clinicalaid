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
async function routeBySession(session: { user: unknown }, navigate: (path: string, opts?: { replace: boolean }) => void) {
  // Refresh to ensure enrichment hook claims are in the JWT
  const { data: refreshed } = await supabase.auth.refreshSession()
  const user = (refreshed?.session?.user ?? session.user) as Record<string, unknown>

  const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const totpRequired = user.totp_required as boolean | undefined
  const needsMfa =
    totpRequired !== false &&
    mfaData?.nextLevel === 'aal2' &&
    mfaData?.currentLevel !== 'aal2'

  if (needsMfa) { navigate('/verify-mfa', { replace: true }); return }

  const role = user.app_role as string | undefined
  if (role === 'doctor' || role === 'admin') navigate('/doctor', { replace: true })
  else if (role === 'receptionist')          navigate('/reception', { replace: true })
  else                                        navigate('/setup', { replace: true })
}

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // First check: session may already exist (PKCE code already exchanged)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { routeBySession(session, navigate); return }

      // Second check: wait for SIGNED_IN event (code not yet exchanged)
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          routeBySession(session, navigate)
        }
      })

      const timeout = setTimeout(() => {
        subscription.unsubscribe()
        navigate('/login', { replace: true })
      }, 8000)

      return () => { clearTimeout(timeout); subscription.unsubscribe() }
    })
  }, [navigate])

  return <LoadingSpinner fullScreen />
}
