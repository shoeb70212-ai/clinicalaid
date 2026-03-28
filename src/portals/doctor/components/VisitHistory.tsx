import { useEffect, useState } from 'react'
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
                    borderColor:     idx === 0 ? '#006a6a' : '#d9e4e8',
                    backgroundColor: idx === 0 ? '#006a6a' : '#ffffff',
                  }}
                />
                {idx < visits.length - 1 && (
                  <div className="mt-1 w-px flex-1" style={{ backgroundColor: '#e8eff1', minHeight: '20px' }} />
                )}
              </div>

              {/* Visit card */}
              <button
                type="button"
                onClick={() => handleExpand(v.id, v.queue_entry_id)}
                className="mb-3 flex-1 cursor-pointer rounded-xl p-3 text-left transition-all"
                style={{
                  backgroundColor: isOpen ? '#e0f4f4' : '#ffffff',
                  boxShadow: '0 1px 4px rgba(42,52,55,0.06)',
                }}
              >
                {/* Date */}
                <p className="text-xs font-semibold" style={{ color: '#006a6a', fontFamily: 'Manrope, sans-serif' }}>
                  {mon} {day}, {yr}
                </p>

                {/* Preview */}
                {!isOpen && previewText && (
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: '#566164' }}>
                    {previewText}
                  </p>
                )}

                {/* Expanded detail */}
                {isOpen && (
                  <div className="mt-2 text-xs leading-relaxed" style={{ color: '#2a3437' }}>
                    {/* Vitals row */}
                    {(v.bp_systolic || v.pulse || v.temperature || v.spo2) && (
                      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: '#566164' }}>
                        {v.bp_systolic && v.bp_diastolic && (
                          <span>BP <strong>{v.bp_systolic}/{v.bp_diastolic}</strong></span>
                        )}
                        {v.pulse      && <span>HR <strong>{v.pulse}</strong></span>}
                        {v.temperature && <span>T <strong>{v.temperature}°F</strong></span>}
                        {v.spo2       && <span>SpO₂ <strong>{v.spo2}%</strong></span>}
                      </div>
                    )}

                    {v.chief_complaint && (
                      <p><span className="font-semibold" style={{ color: '#006a6a' }}>Complaint: </span>{v.chief_complaint}</p>
                    )}
                    {v.examination_notes && (
                      <p className="mt-1"><span className="font-semibold" style={{ color: '#006a6a' }}>Notes: </span>{v.examination_notes}</p>
                    )}

                    {/* Prescription pills */}
                    {rxItems.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 font-semibold" style={{ color: '#006a6a' }}>Rx:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {rxItems.map((item) => (
                            <span key={item.id}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold"
                              style={{ backgroundColor: '#006a6a', color: '#fff' }}>
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
                      <p className="mt-1" style={{ color: '#a9b4b7' }}>Loading attachments…</p>
                    )}
                    {v.queue_entry_id && (thumbsMap[v.queue_entry_id]?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {thumbsMap[v.queue_entry_id].map((t) => (
                          <a key={t.id} href={t.publicUrl} target="_blank" rel="noopener noreferrer"
                            aria-label="Open scanned prescription">
                            <img src={t.publicUrl} alt="Scanned prescription"
                              className="h-14 w-14 rounded-lg object-cover transition-opacity hover:opacity-80"
                              style={{ border: '1px solid #e8eff1' }} />
                          </a>
                        ))}
                      </div>
                    )}

                    {!v.chief_complaint && !v.examination_notes && rxItems.length === 0 && (
                      <p className="italic" style={{ color: '#a9b4b7' }}>No details recorded</p>
                    )}
                  </div>
                )}

                {!isOpen && !previewText && (
                  <p className="mt-1 text-xs italic" style={{ color: '#a9b4b7' }}>No notes recorded</p>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
