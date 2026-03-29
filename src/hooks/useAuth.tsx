import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AuthState, Clinic, StaffRole } from '../types'


const AuthContext = createContext<AuthState & {
  signOut: () => Promise<void>
} | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session:      null,
    staff:        null,
    clinic:       null,
    role:         null,
    totpRequired: true,
    mfaVerified:  false,
    loading:      true,
    authError:    null,
  })

  const loadProfile = useCallback(async (session: Session) => {
    const { data: staffRecord, error: staffError } = await supabase
      .from('staff')
      .select('id, clinic_id, role, is_active, totp_required')
      .eq('user_id', session.user.id)
      .maybeSingle()

    // staffError = real DB/network failure; !staffRecord = no matching active staff row
    if (staffError) {
      setState((s) => ({ ...s, session, loading: false, authError: staffError.message }))
      return
    }
    if (!staffRecord) {
      setState((s) => ({ ...s, session, loading: false, authError: null }))
      return
    }

    const role = staffRecord.role as StaffRole
    const totpRequired = staffRecord.totp_required ?? true

    const { data: clinicRes } = await supabase
      .from('clinics')
      .select('id, name, clinic_mode, primary_color, logo_url, config, is_active')
      .eq('id', staffRecord.clinic_id)
      .single()

    const { data: mfaLevel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const mfaVerified = mfaLevel?.currentLevel === 'aal2'

    setState({
      session,
      staff:        staffRecord as AuthState['staff'],
      clinic:       clinicRes as Clinic | null,
      role,
      totpRequired,
      mfaVerified,
      loading:      false,
      authError:    null,
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    // Register listener first to avoid missing SIGNED_IN on implicit flow
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip INITIAL_SESSION — handled by getSession() below to avoid double load
      if (event === 'INITIAL_SESSION') return
      if (cancelled) return

      if (session) {
        loadProfile(session)
      } else {
        setState({
          session:      null,
          staff:        null,
          clinic:       null,
          role:         null,
          totpRequired: true,
          mfaVerified:  false,
          loading:      false,
          authError:    null,
        })
      }
    })

    // Handle initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session) {
        loadProfile(session)
      } else {
        setState((s) => ({ ...s, loading: false }))
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
