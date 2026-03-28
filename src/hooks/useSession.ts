import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '../types'

/**
 * Loads the active (open) session for a doctor on today's date.
 * Subscribes to session updates via Realtime.
 */
export function useSession(doctorId: string | null) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const fetchSession = useCallback(async () => {
    if (!doctorId) return
    setLoading(true)

    const today = new Date().toISOString().split('T')[0]

    const { data, error: fetchError } = await supabase
      .from('sessions')
      .select('*')
      .eq('doctor_id', doctorId)
      .eq('date', today)
      .in('status', ['open', 'paused'])
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setSession(data as Session | null)
    }
    setLoading(false)
  }, [doctorId])

  useEffect(() => {
    if (!doctorId) return

    fetchSession()

    const channel = supabase
      .channel('sessions-watch')
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'sessions',
          filter: `doctor_id=eq.${doctorId}`,
        },
        (payload) => {
          const updated = payload.new as Session
          setSession((prev) => (prev?.id === updated.id ? updated : prev))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [doctorId, fetchSession])

  return { session, loading, error, refetch: fetchSession }
}
