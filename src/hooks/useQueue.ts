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
      setError(null)
      setQueue(sortQueue(data as QueueEntryWithPatient[]))
    }
    setLoading(false)
  }, [sessionId])

  /** Fetch a single entry with patient join — used for INSERT delta updates */
  const fetchSingleEntry = useCallback(async (entryId: string): Promise<QueueEntryWithPatient | null> => {
    const { data } = await supabase
      .from('queue_entries')
      .select(`
        *,
        patient:patients(id, name, dob, gender, mobile, blood_group, preferred_language)
      `)
      .eq('id', entryId)
      .maybeSingle()
    return data as QueueEntryWithPatient | null
  }, [])

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
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Fetch the new entry with patient join, then append
            fetchSingleEntry(payload.new.id).then((entry) => {
              if (entry) setQueue((prev) => sortQueue([...prev, entry]))
            })
          } else if (payload.eventType === 'UPDATE') {
            // Merge updated queue_entry fields into existing entry (preserves patient join)
            setQueue((prev) => sortQueue(
              prev.map((e) => e.id === payload.new.id ? { ...e, ...payload.new } : e)
            ))
          } else {
            // DELETE — full refetch (rare)
            fetchQueue()
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, fetchQueue, fetchSingleEntry])

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
