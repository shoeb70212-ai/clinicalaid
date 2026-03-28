import { useEffect, useState } from 'react'
import { ClipboardList, ChevronDown, ChevronUp, Paperclip } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Visit } from '../../../types'

interface Props {
  patientId: string
  clinicId:  string
}

interface Thumbnail {
  id:        string
  file_path: string
  publicUrl: string
}

export function VisitHistory({ patientId, clinicId }: Props) {
  const [visits,    setVisits]    = useState<Visit[]>([])
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [thumbsMap, setThumbsMap] = useState<Record<string, Thumbnail[]>>({})
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    supabase
      .from('visits')
      .select('*, prescriptions(*)')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setVisits((data ?? []) as Visit[])
        setLoading(false)
      })
  }, [patientId, clinicId])

  async function loadAttachments(queueEntryId: string) {
    if (thumbsMap[queueEntryId] !== undefined) return

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

  function handleExpand(visitId: string, queueEntryId: string | null) {
    const next = expanded === visitId ? null : visitId
    setExpanded(next)
    if (next && queueEntryId) loadAttachments(queueEntryId)
  }

  const sectionHeader = (
    <div className="mb-3 flex items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
        Past Medical Visits
      </p>
      {!loading && visits.length > 0 && (
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: 'var(--color-primary-container)', color: 'var(--color-primary)' }}>
          {visits.length}
        </span>
      )}
    </div>
  )

  if (loading) return (
    <div className="p-2">
      {sectionHeader}
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface-low)' }}>
            <div className="h-3 w-24 rounded" style={{ backgroundColor: 'var(--color-surface-container)' }} />
            <div className="mt-2 h-2 w-full rounded" style={{ backgroundColor: 'var(--color-surface-container)' }} />
            <div className="mt-1 h-2 w-3/4 rounded" style={{ backgroundColor: 'var(--color-surface-container)' }} />
          </div>
        ))}
      </div>
    </div>
  )

  if (visits.length === 0) return (
    <div className="p-2">
      {sectionHeader}
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-surface-container)' }}>
          <ClipboardList className="h-5 w-5" style={{ color: 'var(--color-muted)' }} aria-hidden="true" />
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No previous visits</p>
      </div>
    </div>
  )

  return (
    <div>
      {sectionHeader}

      {/* Timeline */}
      <div className="relative flex flex-col gap-1">
        {visits.map((v, idx) => {
          const date   = new Date(v.created_at)
          const day    = date.toLocaleDateString('en-IN', { day: '2-digit' })
          const mon    = date.toLocaleDateString('en-IN', { month: 'short' })
          const yr     = date.getFullYear()
          const isOpen = expanded === v.id
          const rxItems = v.prescriptions ?? []
          const preview = [v.chief_complaint, v.examination_notes].filter(Boolean).join(' ')
          const previewText = preview.length > 60 ? preview.slice(0, 60) + '…' : preview

          return (
            <div key={v.id} className="relative flex gap-3">
              {/* Timeline dot + line */}
              <div className="flex flex-col items-center">
                <div
                  className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full border-2"
                  style={{
                    borderColor:     idx === 0 ? 'var(--color-primary)' : 'var(--color-surface-highest)',
                    backgroundColor: idx === 0 ? 'var(--color-primary)' : 'var(--color-surface)',
                  }}
                />
                {idx < visits.length - 1 && (
                  <div className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--color-surface-container)', minHeight: '20px' }} />
                )}
              </div>

              {/* Visit card */}
              <button
                type="button"
                onClick={() => handleExpand(v.id, v.queue_entry_id)}
                className="mb-3 flex-1 cursor-pointer rounded-xl p-3 text-left transition-all active:scale-[0.98]"
                style={{
                  backgroundColor: isOpen ? 'var(--color-primary-container)' : 'var(--color-surface)',
                  boxShadow: isOpen
                    ? '0 0 0 1.5px rgba(0,106,106,0.2), 0 1px 4px rgba(42,52,55,0.06)'
                    : '0 1px 4px rgba(42,52,55,0.06)',
                }}
              >
                {/* Date + token + chevron */}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold font-heading" style={{ color: 'var(--color-primary)' }}>
                    {mon} {day}, {yr}
                  </p>
                  {isOpen
                    ? <ChevronUp  className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                    : <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-muted)' }} aria-hidden="true" />
                  }
                </div>

                {/* Preview */}
                {!isOpen && previewText && (
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {previewText}
                  </p>
                )}

                {/* Expanded detail */}
                {isOpen && (
                  <div className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-ink)' }}>
                    {/* Vitals row */}
                    {(v.bp_systolic || v.pulse || v.temperature || v.spo2) && (
                      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--color-muted)' }}>
                        {v.bp_systolic && v.bp_diastolic && (
                          <span>BP <strong>{v.bp_systolic}/{v.bp_diastolic}</strong></span>
                        )}
                        {v.pulse      && <span>HR <strong>{v.pulse}</strong></span>}
                        {v.temperature && <span>T <strong>{v.temperature}°F</strong></span>}
                        {v.spo2       && <span>SpO₂ <strong>{v.spo2}%</strong></span>}
                      </div>
                    )}

                    {v.chief_complaint && (
                      <p><span className="font-semibold" style={{ color: 'var(--color-primary)' }}>Complaint: </span>{v.chief_complaint}</p>
                    )}
                    {v.examination_notes && (
                      <p className="mt-1"><span className="font-semibold" style={{ color: 'var(--color-primary)' }}>Notes: </span>{v.examination_notes}</p>
                    )}

                    {/* Prescription pills */}
                    {rxItems.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 font-semibold" style={{ color: 'var(--color-primary)' }}>Rx:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {rxItems.map((item) => (
                            <span key={item.id}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold"
                              style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
                              {item.drug_name}
                              <span className="rounded px-1 font-normal"
                                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                                {item.dosage} · {item.duration_days}d
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Attachments (linked by queue_entry_id) */}
                    {v.queue_entry_id && thumbsMap[v.queue_entry_id] === undefined && (
                      <p className="mt-1" style={{ color: 'var(--color-faded)' }}>Loading attachments…</p>
                    )}
                    {v.queue_entry_id && (thumbsMap[v.queue_entry_id]?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 flex items-center gap-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
                          <Paperclip className="h-3 w-3" aria-hidden="true" /> Attachments
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {thumbsMap[v.queue_entry_id].map((t) => (
                            <a key={t.id} href={t.publicUrl} target="_blank" rel="noopener noreferrer"
                              aria-label="Open scanned prescription">
                              <img src={t.publicUrl} alt="Scanned prescription"
                                className="h-14 w-14 rounded-lg object-cover transition-opacity hover:opacity-80"
                                style={{ border: '1px solid var(--color-surface-container)' }} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {!v.chief_complaint && !v.examination_notes && rxItems.length === 0 && (
                      <p className="italic" style={{ color: 'var(--color-faded)' }}>No details recorded</p>
                    )}
                  </div>
                )}

                {!isOpen && !previewText && (
                  <p className="mt-1 text-xs italic" style={{ color: 'var(--color-faded)' }}>No notes recorded</p>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
