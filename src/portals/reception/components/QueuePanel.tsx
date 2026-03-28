import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { updateQueueStatus } from '../../../lib/occ'
import { isValidTransition } from '../../../lib/transitions'
import { calcAge } from '../../../lib/utils'
import type { QueueEntryWithPatient, StaffRole, QueueStatus } from '../../../types'
import { useTranslation } from 'react-i18next'

interface Props {
  queue:       QueueEntryWithPatient[]
  sessionId:   string
  clinicId:    string
  staffRole:   StaffRole
  online:      boolean
  onUpdate:    () => void
  avgSeconds?: number
}

export function QueuePanel({ queue, staffRole, online, onUpdate, avgSeconds = 600 }: Props) {
  const { t } = useTranslation()
  const [transitionError, setTransitionError] = useState<string | null>(null)

  const active = queue.filter((e) => !['COMPLETED', 'CANCELLED'].includes(e.status))

  async function handleTransition(entry: QueueEntryWithPatient, to: QueueStatus) {
    if (!online) return
    setTransitionError(null)
    const result = await updateQueueStatus(entry.id, entry.version, to)
    if (result.success || result.reason === 'conflict') onUpdate()
    else setTransitionError(`Could not update ${entry.patient.name}: ${result.reason ?? 'Unknown error'}`)
  }

  if (active.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-[#0e7490]">
        {t('queue.empty')}
      </div>
    )
  }

  return (
    <>
    {transitionError && (
      <div role="alert" className="flex items-center justify-between px-4 py-2 text-xs"
        style={{ backgroundColor: '#fef2f2', color: '#991b1b', borderBottom: '1px solid #fecaca' }}>
        <span>{transitionError}</span>
        <button type="button" onClick={() => setTransitionError(null)}
          className="ml-2 shrink-0 cursor-pointer font-semibold">Dismiss</button>
      </div>
    )}
    <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 px-4 py-2" aria-label="Queue">
      {active.map((entry, idx) => {
        const age = calcAge(entry.patient.dob ?? null)
        const waitMins = Math.round((idx * avgSeconds) / 60)
        const waitText = idx === 0 ? 'Now' : `~${waitMins} min`

        return (
          <li key={entry.id} className="py-3">
            <div className="flex items-start justify-between gap-4">
              {/* Token + patient info */}
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${statusBg(entry.status)}`}>
                  {entry.token_prefix}-{entry.token_number}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#164e63]">{entry.patient.name}</span>
                    {!entry.identity_verified && entry.source === 'qr_kiosk' && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Unverified
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#0e7490]">
                    {age != null ? `${age}${entry.patient.gender === 'male' ? 'M' : entry.patient.gender === 'female' ? 'F' : ''}` : ''}
                    {entry.patient.blood_group ? ` · ${entry.patient.blood_group}` : ''}
                  </p>
                  <p className="text-xs text-gray-400">
                    {t(`queue.status.${entry.status}`)}
                    <span className="ml-2 font-medium text-[#0891b2]">{waitText}</span>
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {getReceptionActions(entry.status).map(({ to, label, variant }) => {
                  const allowed = isValidTransition(entry.status, to, staffRole, entry.identity_verified)
                  if (!allowed) return null
                  return (
                    <button key={to} onClick={() => handleTransition(entry, to)}
                      disabled={!online}
                      className={`min-h-[44px] cursor-pointer rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variantCls[variant]}`}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
    </>
  )
}

function statusBg(status: string): string {
  return {
    CALLED:          'bg-[#0891b2] text-white',
    CHECKED_IN:      'bg-[#ecfeff] text-[#0891b2]',
    SKIPPED:         'bg-amber-100 text-amber-700',
    IN_CONSULTATION: 'bg-green-100 text-green-700',
    NO_SHOW:         'bg-gray-100 text-gray-500',
  }[status] ?? 'bg-gray-100 text-gray-500'
}

type Variant = 'primary' | 'secondary' | 'danger'
const variantCls: Record<Variant, string> = {
  primary:   'bg-[#0891b2] text-white hover:bg-[#0e7490]',
  secondary: 'border border-gray-200 text-[#164e63] hover:bg-gray-50',
  danger:    'border border-red-200 text-red-600 hover:bg-red-50',
}

function getReceptionActions(status: QueueStatus): { to: QueueStatus; label: string; variant: Variant }[] {
  switch (status) {
    case 'CHECKED_IN':
      return [
        { to: 'CALLED',    label: 'Call',    variant: 'primary'   },
        { to: 'SKIPPED',   label: 'Skip',    variant: 'secondary' },
        { to: 'NO_SHOW',   label: 'No Show', variant: 'secondary' },
        { to: 'CANCELLED', label: 'Cancel',  variant: 'danger'    },
      ]
    case 'CALLED':
      return [
        { to: 'NO_SHOW', label: 'No Show', variant: 'secondary' },
        { to: 'SKIPPED', label: 'Skip',    variant: 'secondary' },
      ]
    case 'SKIPPED':
      return [{ to: 'CHECKED_IN', label: 'Restore', variant: 'secondary' }]
    case 'NO_SHOW':
      return [{ to: 'CHECKED_IN', label: 'Returned', variant: 'secondary' }]
    default:
      return []
  }
}
