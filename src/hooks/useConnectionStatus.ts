import { useEffect, useState } from 'react'

/**
 * Tracks online/offline state using browser events.
 * When offline: all queue mutation buttons must be disabled.
 * OCC requires a DB round-trip — offline writes are never allowed.
 */
export function useConnectionStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const setOn  = () => setOnline(true)
    const setOff = () => setOnline(false)

    window.addEventListener('online',  setOn)
    window.addEventListener('offline', setOff)

    return () => {
      window.removeEventListener('online',  setOn)
      window.removeEventListener('offline', setOff)
    }
  }, [])

  return online
}
