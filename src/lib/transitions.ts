import type { QueueStatus, StaffRole } from '../types'

type OccResult = { success: boolean; reason?: string; data?: unknown }

/**
 * Valid state machine transitions.
 * Source of truth: docs/03-state-machine.md
 *
 * Key: from state → to state → roles that may perform this transition
 * COMPLETED and CANCELLED are terminal — empty object means no transitions out.
 */
const VALID_TRANSITIONS: Record<QueueStatus, Partial<Record<QueueStatus, StaffRole[]>>> = {
  CHECKED_IN: {
    CALLED:    ['doctor', 'receptionist', 'admin'],
    SKIPPED:   ['receptionist', 'admin'],
    NO_SHOW:   ['receptionist', 'admin'],
    CANCELLED: ['receptionist', 'admin'],
  },
  CALLED: {
    IN_CONSULTATION: ['doctor'],                       // identity gate enforced below
    NO_SHOW:         ['doctor', 'receptionist', 'admin'],
    SKIPPED:         ['receptionist', 'admin'],
  },
  IN_CONSULTATION: {
    COMPLETED: ['doctor'],
    SKIPPED:   ['doctor'],   // doctor may skip if patient left mid-consultation
    NO_SHOW:   ['doctor'],   // doctor may mark no-show if patient disappeared
  },
  SKIPPED:   { CHECKED_IN: ['receptionist', 'admin'] },
  NO_SHOW:   { CHECKED_IN: ['receptionist', 'admin'] },
  COMPLETED: {},   // terminal — zero transitions out, ever
  CANCELLED: {},   // terminal — zero transitions out, ever
}

/**
 * Returns true if the transition is valid for the given role.
 *
 * @param from             Current queue status
 * @param to               Target queue status
 * @param role             Staff role performing the transition
 * @param identityVerified queue_entries.identity_verified value
 */
export function isValidTransition(
  from: QueueStatus,
  to: QueueStatus,
  role: StaffRole,
  identityVerified: boolean,
): boolean {
  // Identity gate: must be verified before entering consultation
  if (to === 'IN_CONSULTATION' && !identityVerified) return false

  const allowed = VALID_TRANSITIONS[from]?.[to]
  if (!allowed) return false

  return allowed.includes(role)
}

/**
 * Handles an OCC result: calls onUpdate on success or conflict, onError on genuine failures.
 * Use this as a shared handler wherever queue status transitions occur.
 */
export function handleQueueTransition(
  result: OccResult,
  onUpdate: () => void,
  onError?: (reason: string) => void,
) {
  if (result.success || result.reason === 'conflict') {
    onUpdate()
  } else {
    onError?.(result.reason ?? 'Unknown error')
  }
}

/**
 * Returns all valid target states for a given from-state and role.
 * Used to determine which action buttons to show in the UI.
 */
export function getValidTransitions(
  from: QueueStatus,
  role: StaffRole,
  identityVerified: boolean,
): QueueStatus[] {
  const targets = VALID_TRANSITIONS[from]
  if (!targets) return []

  return (Object.keys(targets) as QueueStatus[]).filter((to) =>
    isValidTransition(from, to, role, identityVerified)
  )
}
