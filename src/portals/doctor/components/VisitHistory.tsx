import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { QueueEntry } from '../../../types'

interface Props {
  patientId: string
  clinicId:  string
}

interface Thumbnail {
  id:        string
  file_path: string
  publicUrl: string
}

// Notes may be a JSON object {"chiefComplaint":"…","quickNotes":"…"} (new format)
// or a plain string (legacy records saved before the JSON format was introduced).
function parseNotes(raw: string): { chiefComplaint: string; quickNotes: string } | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.chiefComplaint === 'string') return parsed
  } catch { /* not JSON — treat as plain text */ }
  return null
}

function parseNotesPreview(raw: string): string {
  const parsed = parseNotes(raw)
  const text = parsed ? [parsed.chiefComplaint, parsed.quickNotes].filter(Boolean).join(' ') : raw
  return text.length > 40 ? text.slice(0, 40) + '…' : text
}

function renderNotes(raw: string) {
  const parsed = parseNotes(raw)
  if (!parsed) return <p>{raw}</p>
  return (
    <>
      {parsed.chiefComplaint && (
        <p><span className="font-medium">Complaint: </span>{parsed.chiefComplaint}</p>
      )}
      {parsed.quickNotes && (
        <p className="mt-1"><span className="font-medium">Notes: </span>{parsed.quickNotes}</p>
      )}
    </>
  )
}

export function VisitHistory({ patientId, clinicId }: Props) {
  const [visits,    setVisits]    = useState<QueueEntry[]>([])
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [thumbsMap, setThumbsMap] = useState<Record<string, Thumbnail[]>>({})
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    supabase
      .from('queue_entries')
      .select('id, created_at, notes, status, token_number, token_prefix')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setVisits((data ?? []) as QueueEntry[])
        setLoading(false)
      })
  }, [patientId, clinicId])

  async function loadAttachments(queueEntryId: string) {
    if (thumbsMap[queueEntryId]) return // already loaded

    const { data, error } = await supabase
      .from('queue_attachments')
      .select('id, file_path')
      .eq('queue_entry_id', queueEntryId)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[VisitHistory] Failed to load attachments:', error.message)
      setThumbsMap((prev) => ({ ...prev, [queueEntryId]: [] }))
      return
    }

    if (!data?.length) {
      setThumbsMap((prev) => ({ ...prev, [queueEntryId]: [] }))
      return
    }

    const thumbnails: Thumbnail[] = data.map((row) => {
      const { data: urlData } = supabase.storage
        .from('clinic-attachments')
        .getPublicUrl(row.file_path)
      return { id: row.id, file_path: row.file_path, publicUrl: urlData.publicUrl }
    })

    setThumbsMap((prev) => ({ ...prev, [queueEntryId]: thumbnails }))
  }

  function handleExpand(visitId: string) {
    const next = expanded === visitId ? null : visitId
    setExpanded(next)
    if (next) loadAttachments(next)
  }

  if (loading) return <p className="p-2 text-xs text-gray-400">Loading history…</p>
  if (visits.length === 0) return <p className="p-2 text-xs text-gray-400">No previous visits</p>

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#0e7490]">Visit History</p>
      {visits.map((v) => (
        <div key={v.id} className="overflow-hidden rounded-lg border border-gray-100">
          <button
            type="button"
            onClick={() => handleExpand(v.id)}
            className="flex w-full cursor-pointer items-center justify-between px-2 py-1.5 text-left hover:bg-gray-50"
          >
            <div>
              <p className="text-xs font-medium text-[#164e63]">
                {new Date(v.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              <p className="text-xs text-gray-400">
                {v.notes ? parseNotesPreview(v.notes) : 'No notes'}
              </p>
            </div>
            {expanded === v.id
              ? <ChevronDown  className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
            }
          </button>

          {expanded === v.id && (
            <div className="border-t border-gray-100 bg-gray-50 px-2 py-2 text-xs text-[#164e63]">
              {v.notes && (
                <div className="mb-2 whitespace-pre-wrap">{renderNotes(v.notes)}</div>
              )}

              {/* Attachment thumbnails — lazy-loaded on expand */}
              {thumbsMap[v.id] === undefined && (
                <p className="text-gray-400">Loading attachments…</p>
              )}
              {thumbsMap[v.id]?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {thumbsMap[v.id].map((t) => (
                    <a
                      key={t.id}
                      href={t.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open scanned prescription"
                    >
                      <img
                        src={t.publicUrl}
                        alt="Scanned prescription"
                        className="h-14 w-14 rounded-lg border border-gray-200 object-cover transition-opacity hover:opacity-80"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
