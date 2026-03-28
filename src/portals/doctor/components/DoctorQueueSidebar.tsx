import { AlertTriangle, UserCheck } from 'lucide-react'
import type { QueueEntryWithPatient } from '../../../types'

interface Props {
  queue:       QueueEntryWithPatient[]
  activeId:    string | null
  onSelect:    (entry: QueueEntryWithPatient) => void
  avgSeconds?: number   // from clinic.config.avg_consultation_seconds
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  CHECKED_IN:      { label: 'Waiting',     color: '#566164', bg: '#f0f4f6' },
  CALLED:          { label: 'Called',       color: '#006a6a', bg: '#e0f4f4' },
  IN_CONSULTATION: { label: 'In Progress',  color: '#005c5c', bg: '#95f2f1' },
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

function avatarStyle(isActive: boolean, isInProgress: boolean) {
  if (isActive)      return { bg: 'rgba(255,255,255,0.15)', color: '#ffffff' }
  if (isInProgress)  return { bg: '#e0f4f4',                color: '#006a6a' }
  return               { bg: '#f0f4f6',                color: '#006a6a' }
}

function waitLabel(index: number, avgSeconds: number): string {
  if (index === 0) return 'Now'
  const mins = Math.round((index * avgSeconds) / 60)
  return `~${mins} min`
}

export function DoctorQueueSidebar({ queue, activeId, onSelect, avgSeconds = 600 }: Props) {
  const visible = queue.filter((e) => !['COMPLETED', 'CANCELLED'].includes(e.status))
  const waiting = visible.filter((e) => e.status === 'CHECKED_IN').length

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#f8fafb' }}>
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(169,180,183,0.2)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164', fontFamily: 'Manrope, sans-serif' }}>
          Queue
        </p>
        <p className="mt-0.5 text-lg font-bold leading-none" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
          {waiting} <span className="text-sm font-medium" style={{ color: '#566164' }}>waiting</span>
        </p>
      </div>

      {/* Patient list */}
      <div className="flex flex-col gap-1 p-2 overflow-y-auto flex-1">
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#e8eff1' }}>
              <UserCheck className="h-5 w-5" style={{ color: '#566164' }} aria-hidden="true" />
            </div>
            <p className="text-sm font-medium" style={{ color: '#2a3437' }}>No patients yet</p>
            <p className="mt-0.5 text-xs" style={{ color: '#566164' }}>Patients appear here when checked in</p>
          </div>
        )}

        {visible.map((entry, idx) => {
          const isActive = activeId === entry.id
          const statusInfo = STATUS_LABEL[entry.status] ?? STATUS_LABEL.CHECKED_IN
          const isInProgress = entry.status === 'IN_CONSULTATION'
          const wait = waitLabel(idx, avgSeconds)

          const av = avatarStyle(isActive, isInProgress)
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry)}
              className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-left transition-all duration-150"
              style={{
                backgroundColor: isActive ? 'var(--color-primary)' : isInProgress ? 'var(--color-primary-container)' : 'var(--color-surface)',
                boxShadow: isActive ? '0 4px 16px rgba(0,106,106,0.2)' : '0 1px 4px rgba(42,52,55,0.06)',
              }}
            >
              <div className="flex items-center gap-2.5">
                {/* Patient initials avatar */}
                <div
                  className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ backgroundColor: av.bg, color: av.color }}
                >
                  {getInitials(entry.patient.name)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums"
                        style={{
                          backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'var(--color-primary-container)',
                          color: isActive ? '#ffffff' : 'var(--color-primary)',
                        }}
                      >
                        {entry.token_prefix}-{entry.token_number}
                      </span>
                      {!entry.identity_verified && entry.source === 'qr_kiosk' && (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Unverified" />
                      )}
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: isActive ? 'rgba(255,255,255,0.15)' : statusInfo.bg,
                        color: isActive ? 'rgba(255,255,255,0.9)' : statusInfo.color,
                      }}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  <p
                    className="truncate text-sm font-semibold font-heading"
                    style={{ color: isActive ? '#ffffff' : 'var(--color-ink)' }}
                  >
                    {entry.patient.name}
                  </p>
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    {entry.patient.mobile && (
                      <p
                        className="truncate text-xs"
                        style={{ color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--color-muted)' }}
                      >
                        {entry.patient.mobile}
                      </p>
                    )}
                    <span
                      className="shrink-0 text-[10px] tabular-nums font-medium"
                      style={{ color: isActive ? 'rgba(255,255,255,0.6)' : 'var(--color-faded, #a9b4b7)' }}
                    >
                      {wait}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
