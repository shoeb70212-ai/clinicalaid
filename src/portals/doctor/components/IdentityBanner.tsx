import { AlertTriangle, ShieldCheck, ShieldX } from 'lucide-react'
import { calcAge } from '../../../lib/utils'
import type { QueueEntryWithPatient } from '../../../types'

interface Props {
  entry:     QueueEntryWithPatient
  loading:   boolean
  online:    boolean
  onConfirm: () => void
  onImposter: () => void
}

export function IdentityBanner({ entry, loading, online, onConfirm, onImposter }: Props) {
  const age = calcAge(entry.patient.dob ?? null)

  return (
    <div className="px-4 py-3" style={{ backgroundColor: 'var(--color-warning-container)', borderBottom: '1px solid #fde68a' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl" style={{ backgroundColor: '#fef3c7' }}>
            <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-warning)' }} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Unverified Check-In</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-warning)' }}>
              Age: {age ?? '—'} · Gender: {entry.patient.gender ?? '—'} · Verify before starting consultation.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={onConfirm} disabled={loading || !online}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirm
          </button>
          <button onClick={onImposter} disabled={loading || !online}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-60"
            style={{ borderColor: '#fca5a5', color: '#991b1b', backgroundColor: '#fff' }}>
            <ShieldX className="h-3.5 w-3.5" aria-hidden="true" /> Mismatch
          </button>
        </div>
      </div>
    </div>
  )
}
