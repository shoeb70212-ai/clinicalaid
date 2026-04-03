import { useEffect, useCallback, useState, useRef } from 'react'
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

  const pendingInsertIds = useRef<string[]>([])
  const insertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

  /** Fetch multiple entries with patient join — used for batched INSERT delta updates */
  const fetchBatchEntries = useCallback(async (entryIds: string[]): Promise<QueueEntryWithPatient[]> => {
    if (entryIds.length === 0) return []
    const { data } = await supabase
      .from('queue_entries')
      .select(`
        *,
        patient:patients(id, name, dob, gender, mobile, blood_group, preferred_language)
      `)
      .in('id', entryIds)
    return (data as QueueEntryWithPatient[]) ?? []
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
            // Batch multiple rapid INSERTs together
            const newId = payload.new.id as string | null
            if (!newId) return
            pendingInsertIds.current.push(newId)
            clearTimeout(insertTimer.current)
            // Single INSERT: fetch immediately. Batch: wait 200ms for more.
            const delay = pendingInsertIds.current.length === 1 ? 0 : 200
            insertTimer.current = setTimeout(async () => {
              const ids = [...pendingInsertIds.current]
              pendingInsertIds.current = []
              const entries = await fetchBatchEntries(ids)
              if (entries.length > 0) setQueue((prev) => sortQueue([...prev, ...entries]))
            }, delay)
          } else if (payload.eventType === 'UPDATE') {
            // Merge updated queue_entry fields — explicitly preserve the patient join
            // because Realtime payload.new contains only raw table columns (no joins)
            setQueue((prev) => sortQueue(
              prev.map((e) => e.id === payload.new.id
                ? { ...e, ...payload.new, patient: e.patient }
                : e
              )
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
      if (insertTimer.current) clearTimeout(insertTimer.current)
    }
  }, [sessionId, fetchQueue, fetchBatchEntries])

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

    // Fetch initial state immediately — Realtime only delivers updates after subscription
    supabase
      .from('queue_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle()
      .then(({ data }) => { if (data) setEntry(data as QueueEntry) })

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
