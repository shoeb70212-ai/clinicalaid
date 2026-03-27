import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { LoadingSpinner } from './LoadingSpinner'
import type { StaffRole } from '../../types'

interface Props {
  children:      ReactNode
  allowedRoles:  StaffRole[]
  requireMFA?:   boolean
}

/**
 * Route guard for staff portals.
 * - Unauthenticated → /login
 * - Wrong role → /unauthorized
 * - requireMFA=true AND totp_required=true AND not aal2 → /verify-mfa
 *   (if admin has set totp_required=false for this staff member, MFA is skipped)
 */
export function ProtectedRoute({ children, allowedRoles, requireMFA = false }: Props) {
  const { session, role, totpRequired, mfaVerified, loading } = useAuth()

  if (loading) return <LoadingSpinner fullScreen />

  if (!session)  return <Navigate to="/login" replace />

  if (!role || !allowedRoles.includes(role as StaffRole)) {
    return <Navigate to="/unauthorized" replace />
  }

  if (requireMFA && totpRequired && !mfaVerified) {
    return <Navigate to="/verify-mfa" replace />
  }

  return <>{children}</>
}
