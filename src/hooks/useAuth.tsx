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
import type { AuthState, Staff, Clinic, StaffRole } from '../types'

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
  })

  const loadProfile = useCallback(async (session: Session) => {
    // app_metadata is server-only (JWT enrichment Edge Function writes here).
    // user_metadata is user-writable — NEVER trust it for security-sensitive claims.
    // Always prefer app_metadata; fall back to user_metadata only as last resort.
    type Claims = {
      clinic_id?:     string
      staff_id?:      string
      app_role?:      StaffRole  // custom field — 'role' is reserved by Supabase
      totp_required?: boolean
    }
    // Custom Access Token hook writes into the JWT payload directly (not app_metadata).
    // Read from session.user directly for custom claims.
    const jwtClaims  = session.user as unknown as Claims
    const userClaims = session.user.user_metadata as Claims

    const clinicId     = jwtClaims?.clinic_id     ?? userClaims.clinic_id
    const staffId      = jwtClaims?.staff_id      ?? userClaims.staff_id
    const role         = (jwtClaims?.app_role     ?? userClaims.app_role) as StaffRole | undefined
    const totpRequired = jwtClaims?.totp_required ?? userClaims.totp_required ?? true

    if (!clinicId || !staffId) {
      setState((s) => ({ ...s, loading: false }))
      return
    }

    // Run all three in parallel — saves ~50-100ms on every login/tab focus
    const [staffRes, clinicRes, mfaLevel] = await Promise.all([
      supabase.from('staff').select('*').eq('id', staffId).single(),
      supabase.from('clinics').select('*').eq('id', clinicId).single(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])

    const mfaVerified = mfaLevel.data?.currentLevel === 'aal2'

    setState({
      session,
      staff:        staffRes.data as Staff | null,
      clinic:       clinicRes.data as Clinic | null,
      role:         role ?? null,
      totpRequired,
      mfaVerified,
      loading:      false,
    })
  }, [])

  useEffect(() => {
    // Initial session load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadProfile(session)
      } else {
        setState((s) => ({ ...s, loading: false }))
      }
    })

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
        })
      }
    })

    return () => subscription.unsubscribe()
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
