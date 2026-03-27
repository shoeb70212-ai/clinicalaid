import type { ConsultationDraft } from '../types'

// Key scoped to both staffId and queueEntryId — prevents one staff member reading
// another's unsaved draft on a shared clinic tablet within the 24-hour TTL window.
const DRAFT_KEY = (staffId: string, queueEntryId: string) =>
  `clinicflow-draft-${staffId}-${queueEntryId}`

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

export function saveDraft(
  staffId: string,
  queueEntryId: string,
  draft: Omit<ConsultationDraft, 'queueEntryId' | 'savedAt'>,
): { saved: boolean } {
  try {
    const payload: ConsultationDraft = {
      ...draft,
      queueEntryId,
      savedAt: Date.now(),
    }
    localStorage.setItem(DRAFT_KEY(staffId, queueEntryId), JSON.stringify(payload))
    return { saved: true }
  } catch {
    // localStorage quota exceeded — caller surfaces a warning to the doctor
    return { saved: false }
  }
}

export function loadDraft(staffId: string, queueEntryId: string): ConsultationDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(staffId, queueEntryId))
    if (!raw) return null

    const parsed = JSON.parse(raw) as ConsultationDraft

    // Reject corrupted entries missing required shape fields
    if (!parsed || typeof parsed.savedAt !== 'number' || typeof parsed.queueEntryId !== 'string') {
      localStorage.removeItem(DRAFT_KEY(staffId, queueEntryId))
      return null
    }

    // Discard stale drafts
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY(staffId, queueEntryId))
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function clearDraft(staffId: string, queueEntryId: string): void {
  localStorage.removeItem(DRAFT_KEY(staffId, queueEntryId))
}
