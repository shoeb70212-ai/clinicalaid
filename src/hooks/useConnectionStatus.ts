import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Tracks online/offline state using browser events + a Supabase ping.
 * The ping detects captive portals where navigator.onLine is true
 * but actual connectivity is blocked.
 */
export function useConnectionStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const pingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function schedulePing() {
    if (pingRef.current) clearTimeout(pingRef.current)
    // Debounce: wait 1s after going "online" before pinging
    pingRef.current = setTimeout(async () => {
      try {
        // select a single row — avoids leaking total clinic count via count header
        const { error } = await supabase
          .from('clinics')
          .select('id')
          .limit(1)
        if (error) setOnline(false)
      } catch {
        setOnline(false)
      }
    }, 1000)
  }

  useEffect(() => {
    function handleOnline() {
      setOnline(true)
      schedulePing()
    }
    function handleOffline() {
      setOnline(false)
      if (pingRef.current) clearTimeout(pingRef.current)
    }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    // Initial ping if browser reports online
    if (typeof navigator !== 'undefined' && navigator.onLine) schedulePing()

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (pingRef.current) clearTimeout(pingRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return online
}
