import { useEffect, useState } from 'react'
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

function parseNotes(raw: string): { chiefComplaint: string; quickNotes: string } | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.chiefComplaint === 'string') return parsed
  } catch { /* plain text */ }
  return null
}

function getPreview(raw: string): string {
  const parsed = parseNotes(raw)
  const text = parsed ? [parsed.chiefComplaint, parsed.quickNotes].filter(Boolean).join(' ') : raw
  return text.length > 60 ? text.slice(0, 60) + '…' : text
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
    if (thumbsMap[queueEntryId]) return

    const { data, error } = await supabase
      .from('queue_attachments')
      .select('id, file_path')
      .eq('queue_entry_id', queueEntryId)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: true })

    if (error) {
      setThumbsMap((prev) => ({ ...prev, [queueEntryId]: [] }))
      return
    }

    const thumbnails: Thumbnail[] = (data ?? []).map((row) => {
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

  if (loading) return (
    <div className="p-2">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
        Past Medical Visits
      </p>
      <p className="text-xs" style={{ color: '#a9b4b7' }}>Loading…</p>
    </div>
  )

  if (visits.length === 0) return (
    <div className="p-2">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
        Past Medical Visits
      </p>
      <p className="text-xs" style={{ color: '#a9b4b7' }}>No previous visits</p>
    </div>
  )

  return (
    <div>
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
        Past Medical Visits
      </p>

      {/* Timeline */}
      <div className="relative flex flex-col gap-1">
        {visits.map((v, idx) => {
          const date = new Date(v.created_at)
          const day  = date.toLocaleDateString('en-IN', { day: '2-digit' })
          const mon  = date.toLocaleDateString('en-IN', { month: 'short' })
          const yr   = date.getFullYear()
          const isOpen = expanded === v.id
          const parsed = v.notes ? parseNotes(v.notes) : null

          return (
            <div key={v.id} className="relative flex gap-3">
              {/* Timeline dot + line */}
              <div className="flex flex-col items-center">
                <div
                  className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full border-2"
                  style={{
                    borderColor: idx === 0 ? '#006a6a' : '#d9e4e8',
                    backgroundColor: idx === 0 ? '#006a6a' : '#ffffff',
                  }}
                />
                {idx < visits.length - 1 && (
                  <div className="w-px flex-1 mt-1" style={{ backgroundColor: '#e8eff1', minHeight: '20px' }} />
                )}
              </div>

              {/* Visit card */}
              <button
                type="button"
                onClick={() => handleExpand(v.id)}
                className="mb-3 flex-1 cursor-pointer rounded-xl p-3 text-left transition-all"
                style={{
                  backgroundColor: isOpen ? '#e0f4f4' : '#ffffff',
                  boxShadow: '0 1px 4px rgba(42,52,55,0.06)',
                }}
              >
                {/* Date + token */}
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-semibold" style={{ color: '#006a6a', fontFamily: 'Manrope, sans-serif' }}>
                    {mon} {day}, {yr}
                  </p>
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: '#f0f4f6', color: '#566164' }}>
                    {v.token_prefix}-{v.token_number}
                  </span>
                </div>

                {/* Preview */}
                {!isOpen && v.notes && (
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: '#566164' }}>
                    {getPreview(v.notes)}
                  </p>
                )}

                {/* Expanded */}
                {isOpen && v.notes && (
                  <div className="mt-2 text-xs leading-relaxed" style={{ color: '#2a3437' }}>
                    {parsed ? (
                      <>
                        {parsed.chiefComplaint && (
                          <p><span className="font-semibold" style={{ color: '#006a6a' }}>Complaint: </span>{parsed.chiefComplaint}</p>
                        )}
                        {parsed.quickNotes && (
                          <p className="mt-1"><span className="font-semibold" style={{ color: '#006a6a' }}>Notes: </span>{parsed.quickNotes}</p>
                        )}
                      </>
                    ) : (
                      <p>{v.notes}</p>
                    )}

                    {/* Attachments */}
                    {thumbsMap[v.id] === undefined && (
                      <p className="mt-1" style={{ color: '#a9b4b7' }}>Loading attachments…</p>
                    )}
                    {thumbsMap[v.id]?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {thumbsMap[v.id].map((t) => (
                          <a key={t.id} href={t.publicUrl} target="_blank" rel="noopener noreferrer"
                            aria-label="Open scanned prescription">
                            <img src={t.publicUrl} alt="Scanned prescription"
                              className="h-14 w-14 rounded-lg object-cover transition-opacity hover:opacity-80"
                              style={{ border: '1px solid #e8eff1' }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!v.notes && <p className="mt-1 text-xs italic" style={{ color: '#a9b4b7' }}>No notes recorded</p>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
