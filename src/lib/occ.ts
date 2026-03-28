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

  // Check for genuine errors FIRST (network failure, RLS rejection, etc.).
  // PGRST116 is PostgREST's "no rows" error code — that is a version conflict, not an error.
  // Belt-and-suspenders: !data check below still catches any edge case where
  // error is not set but data is null.
  if (error && error.code !== 'PGRST116') {
    console.error('[OCC] Unexpected error:', error.code, error.message)
    return { success: false, reason: 'error' }
  }

  if (!data) {
    return { success: false, reason: 'conflict' }
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

  if (error && error.code !== 'PGRST116') {
    console.error('[OCC] Unexpected error:', error.code, error.message)
    return { success: false, reason: 'error' }
  }
  if (!data) {
    return { success: false, reason: 'conflict' }
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

  if (error && error.code !== 'PGRST116') {
    console.error('[OCC] Unexpected error:', error.code, error.message)
    return { success: false, reason: 'error' }
  }
  if (!data) {
    return { success: false, reason: 'conflict' }
  }
  return { success: true, data: data as QueueEntry }
}
