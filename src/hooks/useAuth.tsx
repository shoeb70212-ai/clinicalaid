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
    // Query staff table directly using user's user_id
    // This is more reliable than relying on JWT enrichment edge function
    const { data: staffRecord, error: staffError } = await supabase
      .from('staff')
      .select('id, clinic_id, role, is_active, totp_required')
      .eq('user_id', session.user.id)
      .eq('is_active', true)
      .single()

    if (staffError || !staffRecord) {
      // No staff record = new user going to onboarding
      console.log('[useAuth] No staff record for user:', session.user.id, staffError?.message)
      setState((s) => ({ ...s, loading: false }))
      return
    }

    const clinicId = staffRecord.clinic_id
    const role = staffRecord.role as StaffRole
    const totpRequired = staffRecord.totp_required ?? true

    // Get clinic details
    const { data: clinicRes } = await supabase
      .from('clinics')
      .select('*')
      .eq('id', clinicId)
      .single()

    const { data: mfaLevel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const mfaVerified = mfaLevel?.currentLevel === 'aal2'

    setState({
      session,
      staff: staffRecord as Staff,
      clinic: clinicRes as Clinic | null,
      role,
      totpRequired,
      mfaVerified,
      loading: false,
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
