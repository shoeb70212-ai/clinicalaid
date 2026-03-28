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

type StaffPartial = {
  id: string
  clinic_id: string
  role: string
  is_active: boolean
  totp_required: boolean | null
}

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
    const { data: staffRecord } = await supabase
      .from('staff')
      .select('id, clinic_id, role, is_active, totp_required')
      .eq('user_id', session.user.id)
      .single() as { data: StaffPartial | null }

    if (!staffRecord || !staffRecord.is_active) {
      setState((s) => ({ ...s, session, loading: false }))
      return
    }

    const role = staffRecord.role as StaffRole
    const totpRequired = staffRecord.totp_required ?? true

    const { data: clinicRes } = await supabase
      .from('clinics')
      .select('*')
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
    })
  }, [])

  useEffect(() => {
    // Register listener first to avoid missing SIGNED_IN on implicit flow
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip INITIAL_SESSION — handled by getSession() below to avoid double load
      if (event === 'INITIAL_SESSION') return

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

    // Handle initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadProfile(session)
      } else {
        setState((s) => ({ ...s, loading: false }))
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
