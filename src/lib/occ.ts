import { supabase } from './supabase'
import type { OCCResult, QueueEntry, QueueStatus } from '../types'

/**
 * ALL queue_entries mutations go through this function.
 * Never call supabase.from('queue_entries').update() directly.
 *
 * Pattern:
 *   UPDATE queue_entries
 *   SET status = $newStatus, version = version + 1
 *   WHERE id = $id AND version = $currentVersion
 *   RETURNING *;
 *
 * rows_affected = 0  →  conflict  →  re-fetch  →  re-render silently
 * Never show a conflict error to the user.
 */
export async function updateQueueStatus(
  id: string,
  currentVersion: number,
  newStatus: QueueStatus,
): Promise<OCCResult> {
  // Client sends ONLY status + version.
  // DB BEFORE trigger sets all timestamps (called_at, consultation_started_at, completed_at).
  // NEVER send timestamp fields in the payload.
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ status: newStatus, version: currentVersion + 1 })
    .eq('id', id)
    .eq('version', currentVersion)
    .select()
    .single()

  // !data is the primary conflict signal (version mismatch → 0 rows returned).
  // PGRST116 is PostgREST's "no rows" error code — checked as a secondary signal.
  // Belt-and-suspenders: if !data is true we always treat it as a conflict,
  // regardless of the error code, so a PostgREST version upgrade cannot break OCC.
  if (!data) {
    return { success: false, reason: 'conflict' }
  }

  if (error) {
    console.error('[OCC] Unexpected error:', error.code, error.message)
    return { success: false, reason: 'error' }
  }

  return { success: true, data: data as QueueEntry }
}

/**
 * Write notes to a queue entry via OCC.
 * Called AFTER a successful status transition — use the version from that result.
 * If conflict (another write happened between status change and notes write),
 * the draft is still recoverable from localStorage.
 */
export async function updateQueueNotes(
  id: string,
  currentVersion: number,
  notes: string,
): Promise<OCCResult> {
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ notes, version: currentVersion + 1 })
    .eq('id', id)
    .eq('version', currentVersion)
    .select()
    .single()

  if (!data) {
    return { success: false, reason: 'conflict' }
  }
  if (error) {
    return { success: false, reason: 'error' }
  }
  return { success: true, data: data as QueueEntry }
}

/**
 * Verify patient identity for QR check-in entries.
 * Updates identity_verified = true via OCC pattern.
 */
export async function verifyIdentity(
  id: string,
  currentVersion: number,
): Promise<OCCResult> {
  const { data, error } = await supabase
    .from('queue_entries')
    .update({ identity_verified: true, version: currentVersion + 1 })
    .eq('id', id)
    .eq('version', currentVersion)
    .select()
    .single()

  if (!data) {
    return { success: false, reason: 'conflict' }
  }
  if (error) {
    return { success: false, reason: 'error' }
  }
  return { success: true, data: data as QueueEntry }
}
