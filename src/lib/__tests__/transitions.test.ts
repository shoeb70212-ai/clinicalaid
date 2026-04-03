import { describe, it, expect } from 'vitest'
import { isValidTransition, getValidTransitions } from '../transitions'

describe('isValidTransition', () => {
  describe('valid transitions', () => {
    it('allows CHECKED_IN → CALLED for receptionist', () => {
      expect(isValidTransition('CHECKED_IN', 'CALLED', 'receptionist', true)).toBe(true)
    })

    it('allows CHECKED_IN → CALLED for doctor', () => {
      expect(isValidTransition('CHECKED_IN', 'CALLED', 'doctor', true)).toBe(true)
    })

    it('allows CHECKED_IN → CALLED for admin', () => {
      expect(isValidTransition('CHECKED_IN', 'CALLED', 'admin', true)).toBe(true)
    })

    it('allows CHECKED_IN → SKIPPED for receptionist', () => {
      expect(isValidTransition('CHECKED_IN', 'SKIPPED', 'receptionist', true)).toBe(true)
    })

    it('allows CHECKED_IN → NO_SHOW for receptionist', () => {
      expect(isValidTransition('CHECKED_IN', 'NO_SHOW', 'receptionist', true)).toBe(true)
    })

    it('allows CHECKED_IN → CANCELLED for receptionist', () => {
      expect(isValidTransition('CHECKED_IN', 'CANCELLED', 'receptionist', true)).toBe(true)
    })

    it('allows CALLED → IN_CONSULTATION for doctor with verified identity', () => {
      expect(isValidTransition('CALLED', 'IN_CONSULTATION', 'doctor', true)).toBe(true)
    })

    it('allows CALLED → NO_SHOW for doctor', () => {
      expect(isValidTransition('CALLED', 'NO_SHOW', 'doctor', true)).toBe(true)
    })

    it('allows CALLED → SKIPPED for receptionist', () => {
      expect(isValidTransition('CALLED', 'SKIPPED', 'receptionist', true)).toBe(true)
    })

    it('allows IN_CONSULTATION → COMPLETED for doctor', () => {
      expect(isValidTransition('IN_CONSULTATION', 'COMPLETED', 'doctor', true)).toBe(true)
    })

    it('allows IN_CONSULTATION → SKIPPED for doctor', () => {
      expect(isValidTransition('IN_CONSULTATION', 'SKIPPED', 'doctor', true)).toBe(true)
    })

    it('allows IN_CONSULTATION → NO_SHOW for doctor', () => {
      expect(isValidTransition('IN_CONSULTATION', 'NO_SHOW', 'doctor', true)).toBe(true)
    })

    it('allows SKIPPED → CHECKED_IN for receptionist', () => {
      expect(isValidTransition('SKIPPED', 'CHECKED_IN', 'receptionist', true)).toBe(true)
    })

    it('allows SKIPPED → CHECKED_IN for admin', () => {
      expect(isValidTransition('SKIPPED', 'CHECKED_IN', 'admin', true)).toBe(true)
    })

    it('allows NO_SHOW → CHECKED_IN for receptionist', () => {
      expect(isValidTransition('NO_SHOW', 'CHECKED_IN', 'receptionist', true)).toBe(true)
    })

    it('allows NO_SHOW → CHECKED_IN for admin', () => {
      expect(isValidTransition('NO_SHOW', 'CHECKED_IN', 'admin', true)).toBe(true)
    })
  })

  describe('identity gate', () => {
    it('blocks CALLED → IN_CONSULTATION when identity NOT verified', () => {
      expect(isValidTransition('CALLED', 'IN_CONSULTATION', 'doctor', false)).toBe(false)
    })

    it('allows other transitions regardless of identity verification', () => {
      expect(isValidTransition('CALLED', 'NO_SHOW', 'doctor', false)).toBe(true)
    })
  })

  describe('terminal states', () => {
    it('blocks COMPLETED → anything', () => {
      expect(isValidTransition('COMPLETED', 'CHECKED_IN', 'doctor', true)).toBe(false)
      expect(isValidTransition('COMPLETED', 'CALLED', 'doctor', true)).toBe(false)
      expect(isValidTransition('COMPLETED', 'IN_CONSULTATION', 'doctor', true)).toBe(false)
      expect(isValidTransition('COMPLETED', 'COMPLETED', 'doctor', true)).toBe(false)
    })

    it('blocks CANCELLED → anything', () => {
      expect(isValidTransition('CANCELLED', 'CHECKED_IN', 'receptionist', true)).toBe(false)
      expect(isValidTransition('CANCELLED', 'CALLED', 'receptionist', true)).toBe(false)
      expect(isValidTransition('CANCELLED', 'COMPLETED', 'receptionist', true)).toBe(false)
    })
  })

  describe('role-based restrictions', () => {
    it('blocks receptionist from transitioning to IN_CONSULTATION', () => {
      expect(isValidTransition('CALLED', 'IN_CONSULTATION', 'receptionist', true)).toBe(false)
    })

    it('blocks receptionist from completing consultation', () => {
      expect(isValidTransition('IN_CONSULTATION', 'COMPLETED', 'receptionist', true)).toBe(false)
    })

    it('blocks doctor from skipping from CHECKED_IN', () => {
      expect(isValidTransition('CHECKED_IN', 'SKIPPED', 'doctor', true)).toBe(false)
    })

    it('blocks doctor from cancelling from CHECKED_IN', () => {
      expect(isValidTransition('CHECKED_IN', 'CANCELLED', 'doctor', true)).toBe(false)
    })
  })

  describe('invalid transitions', () => {
    it('blocks CHECKED_IN → COMPLETED directly', () => {
      expect(isValidTransition('CHECKED_IN', 'COMPLETED', 'doctor', true)).toBe(false)
    })

    it('blocks IN_CONSULTATION → CALLED', () => {
      expect(isValidTransition('IN_CONSULTATION', 'CALLED', 'doctor', true)).toBe(false)
    })

    it('blocks SKIPPED → NO_SHOW', () => {
      expect(isValidTransition('SKIPPED', 'NO_SHOW', 'receptionist', true)).toBe(false)
    })
  })
})

describe('getValidTransitions', () => {
  it('returns all valid transitions from CHECKED_IN for receptionist', () => {
    const transitions = getValidTransitions('CHECKED_IN', 'receptionist', true)
    expect(transitions).toContain('CALLED')
    expect(transitions).toContain('SKIPPED')
    expect(transitions).toContain('NO_SHOW')
    expect(transitions).toContain('CANCELLED')
    expect(transitions).not.toContain('IN_CONSULTATION')
    expect(transitions).not.toContain('COMPLETED')
  })

  it('returns IN_CONSULTATION for doctor when identity is verified', () => {
    const transitions = getValidTransitions('CALLED', 'doctor', true)
    expect(transitions).toContain('IN_CONSULTATION')
  })

  it('does not return IN_CONSULTATION for doctor when identity is not verified', () => {
    const transitions = getValidTransitions('CALLED', 'doctor', false)
    expect(transitions).not.toContain('IN_CONSULTATION')
  })

  it('returns empty array for terminal states', () => {
    expect(getValidTransitions('COMPLETED', 'doctor', true)).toHaveLength(0)
    expect(getValidTransitions('CANCELLED', 'receptionist', true)).toHaveLength(0)
  })
})