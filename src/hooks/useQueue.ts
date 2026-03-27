import { useEffect, useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { QueueEntry, QueueEntryWithPatient } from '../types'

/**
 * Subscribes to queue_entries for a session via Supabase Realtime.
 * Returns the live queue, sorted per the state machine sort order.
 * Unsubscribes on unmount.
 */
export function useQueue(sessionId: string | null) {
  const [queue, setQueue] = useState<QueueEntryWithPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchQueue = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)

    const { data, error: fetchError } = await supabase
      .from('queue_entries')
      .select(`
        *,
        patient:patients(id, name, dob, gender, mobile, blood_group, preferred_language)
      `)
      .eq('session_id', sessionId)
      .order('status', { ascending: true })  // dynamic sort handled client-side below
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setQueue(sortQueue(data as QueueEntryWithPatient[]))
    }
    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return

    fetchQueue()

    // Max 1 channel per portal — filtered to this session only
    const channel = supabase
      .channel(`queue-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'queue_entries',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          // Re-fetch on any change — ensures patient join data is fresh
          fetchQueue()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, fetchQueue])

  return { queue, loading, error, refetch: fetchQueue }
}

/**
 * Dynamic queue sort order from docs/03-state-machine.md.
 * No position column — sort computed at runtime.
 */
function sortQueue(entries: QueueEntryWithPatient[]): QueueEntryWithPatient[] {
  const ORDER: Record<string, number> = {
    CALLED:          0,
    CHECKED_IN:      1,
    SKIPPED:         2,
    IN_CONSULTATION: 3,
    NO_SHOW:         4,
    COMPLETED:       5,
    CANCELLED:       6,
  }

  return [...entries].sort((a, b) => {
    const orderDiff = (ORDER[a.status] ?? 99) - (ORDER[b.status] ?? 99)
    if (orderDiff !== 0) return orderDiff
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

/**
 * Subscribes to a single queue entry for the doctor's active consultation.
 */
export function useQueueEntry(entryId: string | null) {
  const [entry, setEntry] = useState<QueueEntry | null>(null)

  useEffect(() => {
    if (!entryId) return

    const channel = supabase
      .channel(`entry-${entryId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'queue_entries',
          filter: `id=eq.${entryId}`,
        },
        (payload) => {
          setEntry(payload.new as QueueEntry)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [entryId])

  return entry
}
