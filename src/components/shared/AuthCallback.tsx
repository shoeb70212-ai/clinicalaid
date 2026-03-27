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
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // detectSessionInUrl:true in supabase.ts means the client automatically
    // processes the ?code= or #access_token= from the URL on init.
    // We just need to wait for SIGNED_IN to fire, then route.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'SIGNED_IN' || !session) return
      subscription.unsubscribe()

      let s = session

      // Refresh once to ensure JWT enrichment claims are present
      if (!s.user.app_metadata?.role) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        if (refreshed?.session) s = refreshed.session
      }

      const appClaims = s.user.app_metadata as { role?: string; totp_required?: boolean }

      const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      const needsMfa =
        appClaims.totp_required !== false &&
        mfaData?.nextLevel === 'aal2' &&
        mfaData?.currentLevel !== 'aal2'

      if (needsMfa) {
        navigate('/verify-mfa', { replace: true })
        return
      }

      const role = appClaims.role
      if (role === 'doctor' || role === 'admin') {
        navigate('/doctor', { replace: true })
      } else if (role === 'receptionist') {
        navigate('/reception', { replace: true })
      } else {
        navigate('/setup', { replace: true })
      }
    })

    // Timeout: if no SIGNED_IN fires in 8s, send back to login
    const timeout = setTimeout(() => {
      subscription.unsubscribe()
      navigate('/login', { replace: true })
    }, 8000)

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [navigate])

  return <LoadingSpinner fullScreen />
}
