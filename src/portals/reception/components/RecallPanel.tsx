import { useState, useEffect, useCallback } from 'react'
import { Bell, Phone, RefreshCw, UserPlus } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface RecallRow {
  visit_id:          string
  patient_id:        string
  patient_name:      string
  patient_mobile:    string
  visit_date:        string
  chief_complaint:   string | null
  max_duration_days: number
  recall_due_date:   string
  days_overdue:      number
}

interface Props {
  clinicId:  string
  sessionId: string | null
  online:    boolean
  onQueued?: () => void
}

export function RecallPanel({ clinicId, sessionId, online, onQueued }: Props) {
  const [rows,    setRows]    = useState<RecallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [queuing, setQueuing] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const fetchRecall = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('get_recall_due', {
      p_clinic_id: clinicId,
    })
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setRows((data ?? []) as RecallRow[])
    }
    setLoading(false)
  }, [clinicId])

  useEffect(() => { fetchRecall() }, [fetchRecall])

  async function handleAddToQueue(row: RecallRow) {
    if (!sessionId || !online) return
    setQueuing(row.patient_id)
    const { error: addError } = await supabase.rpc('add_to_queue', {
      p_session_id:  sessionId,
      p_clinic_id:   clinicId,
      p_patient_id:  row.patient_id,
      p_type:        'walk_in',
      p_source:      'reception',
      p_notes:       `Recall visit — previous treatment: ${row.chief_complaint ?? 'N/A'}`,
    })
    setQueuing(null)
    if (!addError) {
      // Remove from recall list optimistically
      setRows((prev) => prev.filter((r) => r.patient_id !== row.patient_id))
      onQueued?.()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'rgba(169,180,183,0.2)', backgroundColor: '#fff' }}>
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" style={{ color: '#b45309' }} />
          <span className="text-sm font-bold" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
            Due for Recall
          </span>
          {!loading && rows.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
              style={{ backgroundColor: '#b45309' }}>
              {rows.length}
            </span>
          )}
        </div>
        <button type="button" onClick={fetchRecall} disabled={loading}
          className="cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-gray-50 disabled:opacity-50"
          aria-label="Refresh recall list">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} style={{ color: '#566164' }} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <p className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-xs" style={{ color: '#a9b4b7' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: '#fef9f0' }}>
              <Bell className="h-5 w-5" style={{ color: '#b45309' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#566164' }}>No recalls due</p>
            <p className="mt-1 text-xs" style={{ color: '#a9b4b7' }}>Patients will appear here when their prescription period ends</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.patient_id}
                className="rounded-xl p-3"
                style={{ backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(42,52,55,0.06)' }}>
                {/* Patient header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
                      {row.patient_name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1 text-xs" style={{ color: '#566164' }}>
                      <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {row.patient_mobile}
                    </div>
                  </div>
                  {/* Overdue badge */}
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      backgroundColor: row.days_overdue > 7 ? '#fef2f2' : '#fef9f0',
                      color:           row.days_overdue > 7 ? '#991b1b' : '#92400e',
                    }}>
                    {row.days_overdue === 0 ? 'Due today' : `${row.days_overdue}d overdue`}
                  </span>
                </div>

                {/* Visit context */}
                <div className="mt-2 text-xs" style={{ color: '#566164' }}>
                  <span>Last visit: {new Date(row.visit_date + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <span className="mx-1.5" style={{ color: '#d9e4e8' }}>·</span>
                  <span>{row.max_duration_days}d course</span>
                </div>
                {row.chief_complaint && (
                  <p className="mt-1 line-clamp-1 text-xs italic" style={{ color: '#a9b4b7' }}>
                    {row.chief_complaint}
                  </p>
                )}

                {/* Add to queue button */}
                {sessionId && online && (
                  <button
                    type="button"
                    onClick={() => handleAddToQueue(row)}
                    disabled={queuing === row.patient_id}
                    className="mt-2.5 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-bold text-white transition-all disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    {queuing === row.patient_id ? 'Adding…' : 'Add to Today\'s Queue'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
