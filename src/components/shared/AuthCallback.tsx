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
  console.log('[AuthCallback] routeBySession started')

  // Refresh to ensure enrichment hook claims are in the JWT
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()

  if (refreshError) {
    console.error('[AuthCallback] Refresh error:', refreshError)
  }

  const refreshedUser = refreshed?.session?.user ?? session.user as { app_metadata?: Record<string, unknown> }
  const appMetadata = refreshedUser?.app_metadata ?? {}

  console.log('[AuthCallback] app_metadata:', JSON.stringify(appMetadata))

  const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const totpRequired = appMetadata.totp_required as boolean | undefined
  const needsMfa =
    totpRequired !== false &&
    mfaData?.nextLevel === 'aal2' &&
    mfaData?.currentLevel !== 'aal2'

  if (needsMfa) { navigate('/verify-mfa', { replace: true }); return }

  const role = appMetadata.app_role as string | undefined
  console.log('[AuthCallback] Role:', role)

  if (role === 'doctor' || role === 'admin') navigate('/doctor', { replace: true })
  else if (role === 'receptionist')          navigate('/reception', { replace: true })
  else                                        navigate('/setup', { replace: true })
}

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    console.log('[AuthCallback] mounted, url:', window.location.href)

    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[AuthCallback] getSession result:', session ? 'HAS SESSION' : 'NO SESSION', session?.user?.id)
      if (session) { routeBySession(session, navigate); return }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log('[AuthCallback] onAuthStateChange event:', event, session?.user?.id)
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          routeBySession(session, navigate)
        }
      })

      const timeout = setTimeout(() => {
        console.log('[AuthCallback] TIMEOUT — no session after 8s, redirecting to login')
        subscription.unsubscribe()
        navigate('/login', { replace: true })
      }, 8000)

      return () => { clearTimeout(timeout); subscription.unsubscribe() }
    })
  }, [navigate])

  return <LoadingSpinner fullScreen />
}
