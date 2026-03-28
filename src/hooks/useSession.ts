import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '../types'

/**
 * Loads the active (open) session for a doctor or clinic on today's date.
 * Subscribes to session updates via Realtime.
 *
 * - Doctor portal: pass doctorId, leave clinicId undefined
 * - Reception portal: pass null as doctorId and pass clinicId to query by clinic
 *   (team mode — receptionist finds the doctor's active session for the clinic)
 */
export function useSession(doctorId: string | null, clinicId?: string | null) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const fetchSession = useCallback(async () => {
    if (!doctorId && !clinicId) return
    setLoading(true)

    const today = new Date().toISOString().split('T')[0]

    let query = supabase
      .from('sessions')
      .select('*')
      .eq('date', today)
      .in('status', ['open', 'paused'])
      .order('opened_at', { ascending: false })
      .limit(1)

    if (doctorId) {
      query = query.eq('doctor_id', doctorId)
    } else {
      query = query.eq('clinic_id', clinicId!)
    }

    const { data, error: fetchError } = await query.maybeSingle()

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setSession(data as Session | null)
    }
    setLoading(false)
  }, [doctorId, clinicId])

  useEffect(() => {
    if (!doctorId && !clinicId) return

    fetchSession()

    const channelKey   = doctorId ?? clinicId
    const filterClause = doctorId
      ? `doctor_id=eq.${doctorId}`
      : `clinic_id=eq.${clinicId}`

    const channel = supabase
      .channel(`sessions-watch-${channelKey}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'sessions',
          filter: filterClause,
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
  }, [doctorId, clinicId, fetchSession])

  return { session, loading, error, refetch: fetchSession }
}
