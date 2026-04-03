import { useState, useEffect } from 'react'
import { Download, FileText } from 'lucide-react'
import type { QueueEntryWithPatient, QueueStatus } from '../../../types'

type Urgency = 'routine' | 'urgent' | 'emergency'

interface Props {
  entry:             QueueEntryWithPatient
  canStart:          boolean
  hasRxItems:        boolean
  loading:           boolean
  online:            boolean
  saveFailed:        boolean
  transitionError:   string | null
  onTransition:      (to: QueueStatus) => void
  onDownloadRx:      () => void
  onDismissError:    () => void
  onWriteReferral?:  (toSpecialty: string, urgency: Urgency) => void
}

export function ConsultationActions({
  entry, canStart, hasRxItems, loading, online,
  saveFailed, transitionError,
  onTransition, onDownloadRx, onDismissError, onWriteReferral,
}: Props) {
  const [showReferral,    setShowReferral]    = useState(false)
  const [referToValue,    setReferToValue]    = useState('')
  const [urgency,         setUrgency]         = useState<Urgency>('routine')
  const [confirmEnd,      setConfirmEnd]      = useState(false)

  // Auto-revert confirm state after 2 seconds
  useEffect(() => {
    if (!confirmEnd) return
    const t = setTimeout(() => setConfirmEnd(false), 2000)
    return () => clearTimeout(t)
  }, [confirmEnd])

  return (
    <>
      {/* Inline referral form */}
      {showReferral && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
          style={{ backgroundColor: '#e0f4f4', borderTop: '1px solid rgba(0,106,106,0.15)' }}>
          <span className="font-semibold" style={{ color: '#006a6a' }}>Referral to:</span>
          <input
            type="text"
            value={referToValue}
            onChange={(e) => setReferToValue(e.target.value)}
            placeholder="Specialty / doctor name…"
            autoFocus
            className="rounded-lg px-2 py-1 text-xs focus:outline-none"
            style={{ backgroundColor: '#ffffff', border: '1.5px solid #006a6a', color: '#2a3437', minWidth: '160px' }}
          />
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as Urgency)}
            className="cursor-pointer rounded-lg px-2 py-1 text-xs focus:outline-none"
            style={{ backgroundColor: '#ffffff', border: '1.5px solid #006a6a', color: '#2a3437' }}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
          <button type="button"
            disabled={!referToValue.trim()}
            onClick={() => {
              onWriteReferral?.(referToValue.trim(), urgency)
              setShowReferral(false)
              setReferToValue('')
              setUrgency('routine')
            }}
            className="cursor-pointer rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: '#006a6a' }}>
            Generate PDF
          </button>
          <button type="button" onClick={() => setShowReferral(false)}
            className="cursor-pointer rounded-lg px-2 py-1 text-xs"
            style={{ color: '#566164' }}>
            Cancel
          </button>
        </div>
      )}

      {transitionError && (
        <div role="alert" className="flex items-center justify-between px-3 py-1.5 text-xs"
          style={{ backgroundColor: '#fef2f2', color: '#991b1b', borderTop: '1px solid #fecaca' }}>
          <span>{transitionError}</span>
          <button type="button" onClick={onDismissError}
            className="ml-2 shrink-0 cursor-pointer font-semibold">Dismiss</button>
        </div>
      )}
      <div className="flex items-center gap-2 p-3"
        style={{ borderTop: '1px solid rgba(169,180,183,0.15)', backgroundColor: 'var(--color-surface)' }}>
        {/* Auto-save indicator */}
        <span className="text-[10px] tabular-nums" style={{ color: saveFailed ? '#991b1b' : '#166534' }}>
          {saveFailed ? '⚠ Save failed' : '✓ Auto-saved'}
        </span>
        <div className="flex flex-1 justify-end gap-2">
          {canStart && (
            <button onClick={() => onTransition('IN_CONSULTATION')}
              disabled={loading || !online}
              className="cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}>
              Start Consultation
            </button>
          )}
          {entry.status === 'IN_CONSULTATION' && (
            <>
              <button onClick={() => {
                if (confirmEnd) {
                  onTransition('COMPLETED')
                  setConfirmEnd(false)
                } else {
                  setConfirmEnd(true)
                }
              }}
                disabled={loading || !online}
                className="flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                style={{
                  background: confirmEnd
                    ? 'linear-gradient(135deg, #dc2626, #991b1b)'
                    : 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))'
                }}>
                {confirmEnd ? '⚠ Confirm End?' : '✓ End Consultation'}
              </button>
              <button onClick={() => onTransition('SKIPPED')}
                disabled={loading || !online}
                className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-surface-low)', color: 'var(--color-muted)' }}>
                Skip
              </button>
              <button onClick={() => onTransition('NO_SHOW')}
                disabled={loading || !online}
                className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-surface-low)', color: 'var(--color-muted)' }}>
                No Show
              </button>
            </>
          )}
          {entry.status === 'IN_CONSULTATION' && onWriteReferral && (
            <button onClick={() => setShowReferral((v) => !v)}
              className="cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition-all active:scale-95"
              style={{ borderColor: 'var(--color-surface-highest)', color: 'var(--color-primary)', backgroundColor: showReferral ? '#e0f4f4' : 'var(--color-surface)' }}
              aria-label="Write referral letter"
              title="Write Referral">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {hasRxItems && (
            <button onClick={onDownloadRx}
              className="cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition-all active:scale-95"
              style={{ borderColor: 'var(--color-surface-highest)', color: 'var(--color-primary)', backgroundColor: 'var(--color-surface)' }}
              aria-label="Download prescription PDF"
              title="Download Rx PDF">
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </>
  )
}
