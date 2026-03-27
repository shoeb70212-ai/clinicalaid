import { AlertTriangle } from 'lucide-react'
import type { QueueEntryWithPatient } from '../../../types'

interface Props {
  queue:     QueueEntryWithPatient[]
  activeId:  string | null
  onSelect:  (entry: QueueEntryWithPatient) => void
}

export function DoctorQueueSidebar({ queue, activeId, onSelect }: Props) {
  const visible = queue.filter((e) => !['COMPLETED', 'CANCELLED'].includes(e.status))

  return (
    <div className="flex flex-col gap-0.5 p-2">
      <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#0e7490]">
        Waiting ({visible.filter((e) => e.status === 'CHECKED_IN').length})
      </p>
      {visible.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-gray-400">Queue is empty</p>
      )}
      {visible.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry)}
          className={`w-full cursor-pointer rounded-lg px-2 py-2 text-left text-sm transition-colors duration-150 ${
            activeId === entry.id
              ? 'bg-[#0891b2] text-white'
              : 'text-[#164e63] hover:bg-[#ecfeff]'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-medium">
              {entry.token_prefix}-{entry.token_number}
            </span>
            {!entry.identity_verified && entry.source === 'qr_kiosk' && (
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" aria-label="Unverified" />
            )}
          </div>
          <span className={`block truncate text-xs ${activeId === entry.id ? 'text-white/80' : 'text-[#0e7490]'}`}>
            {entry.patient.name}
          </span>
        </button>
      ))}
    </div>
  )
}
