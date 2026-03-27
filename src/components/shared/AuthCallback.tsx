import { useEffect, useRef } from 'react'
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
  const processed = useRef(false)

  useEffect(() => {
    // Guard against double-firing in React StrictMode
    if (processed.current) return
    processed.current = true

    async function handleCallback() {
      // exchangeCodeForSession reads `code` from the URL automatically
      const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href)

      if (error || !data.session) {
        // OAuth failed or code was already consumed — send back to login
        navigate('/login', { replace: true })
        return
      }

      let session = data.session

      // If the JWT enrichment Edge Function had a cold start, app_metadata may be empty
      // on the first exchange. Refresh once to get the enriched JWT before routing.
      if (!session.user.app_metadata?.role) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        if (refreshed?.session) session = refreshed.session
      }

      // Check if TOTP is needed (totp_required in JWT claims)
      const appClaims = session.user.app_metadata as {
        role?: string
        totp_required?: boolean
      }

      const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      const needsMfa =
        appClaims.totp_required !== false &&
        mfaData?.nextLevel === 'aal2' &&
        mfaData?.currentLevel !== 'aal2'

      if (needsMfa) {
        navigate('/verify-mfa', { replace: true })
        return
      }

      // Route by role
      const role = appClaims.role
      if (role === 'doctor' || role === 'admin') {
        navigate('/doctor', { replace: true })
      } else if (role === 'receptionist') {
        navigate('/reception', { replace: true })
      } else {
        // New Google sign-up with no staff record yet → onboarding
        navigate('/setup', { replace: true })
      }
    }

    handleCallback()
  }, [navigate])

  return <LoadingSpinner fullScreen />
}
