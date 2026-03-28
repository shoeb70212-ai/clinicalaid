import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { LoadingSpinner } from './LoadingSpinner'

/**
 * OAuth redirect landing page.
 * With implicit flow, Supabase parses the hash token on client init and fires
 * SIGNED_IN via onAuthStateChange. We register the listener BEFORE calling
 * getSession() so the event is never missed.
 * Route: /auth/callback
 */
type NavFn = (path: string, opts?: { replace: boolean }) => void

async function routeBySession(session: { user: { id: string } }, navigate: NavFn) {
  const { data: staffRecord } = await supabase
    .from('staff')
    .select('id, clinic_id, role, is_active, totp_required')
    .eq('user_id', session.user.id)
    .single()

  if (!staffRecord) {
    navigate('/setup', { replace: true })
    return
  }

  if (!staffRecord.is_active) {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
    return
  }

  const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const needsMfa =
    staffRecord.totp_required !== false &&
    mfaData?.nextLevel === 'aal2' &&
    mfaData?.currentLevel !== 'aal2'

  if (needsMfa) {
    navigate('/verify-mfa', { replace: true })
    return
  }

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
    let done = false

    // Register listener FIRST — implicit flow fires SIGNED_IN during client
    // init, before React mounts. We must not miss it.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && !done) {
        done = true
        subscription.unsubscribe()
        clearTimeout(fallback)
        routeBySession(session, navigate)
      }
    })

    // Also check if a session was already parsed before the listener registered
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !done) {
        done = true
        subscription.unsubscribe()
        clearTimeout(fallback)
        routeBySession(session, navigate)
      }
    })

    // Safety fallback — should never fire in practice
    const fallback = setTimeout(() => {
      if (!done) {
        done = true
        subscription.unsubscribe()
        navigate('/login', { replace: true })
      }
    }, 10000)

    return () => {
      done = true
      clearTimeout(fallback)
      subscription.unsubscribe()
    }
  }, [navigate])

  return <LoadingSpinner fullScreen />
}
