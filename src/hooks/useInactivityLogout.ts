import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const CHANNEL_NAME = 'clinicflow_activity'

/**
 * Cross-tab inactivity logout using BroadcastChannel API.
 *
 * Logout only fires if ALL tabs have been idle beyond timeoutMs.
 * Prevents Tab B timing out and killing the active session in Tab A.
 *
 * Usage:
 *   DoctorPortal:    useInactivityLogout(15 * 60 * 1000)   // 15 min
 *   ReceptionPortal: useInactivityLogout(30 * 60 * 1000)   // 30 min
 */
export function useInactivityLogout(timeoutMs: number): void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const bcRef    = useRef<BroadcastChannel | undefined>(undefined)

  useEffect(() => {
    // BroadcastChannel may throw in Safari <15.3 or private/incognito mode.
    // Fallback: single-tab inactivity timer (no cross-tab coordination).
    try {
      bcRef.current = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      bcRef.current = undefined
    }

    const logout = async () => {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }

    const startTimer = () => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(logout, timeoutMs)
    }

    const broadcast = () => {
      bcRef.current?.postMessage({ lastActive: Date.now() })
    }

    // Another tab sent activity — reset our timer
    if (bcRef.current) {
      bcRef.current.onmessage = () => {
        startTimer()
      }
    }

    // Throttle: fire at most once per 5 seconds to reduce BroadcastChannel traffic
    let lastFired = 0
    const throttledReset = () => {
      const now = Date.now()
      if (now - lastFired > 5000) {
        lastFired = now
        startTimer()
        broadcast()
      }
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, throttledReset))
    startTimer()

    return () => {
      events.forEach((e) => window.removeEventListener(e, throttledReset))
      clearTimeout(timerRef.current)
      bcRef.current?.close()
    }
  }, [timeoutMs])
}
