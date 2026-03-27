import { WifiOff } from 'lucide-react'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'

/**
 * Permanent banner shown when internet connection is lost.
 * All queue mutation buttons must be disabled when offline.
 */
export function OfflineBanner() {
  const online = useConnectionStatus()

  if (online) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center gap-2 bg-red-600 px-4 py-2 text-sm text-white"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Connection lost — queue paused to prevent data conflicts.
        You can still read the current patient's profile.
        All action buttons will re-enable when connection returns.
      </span>
    </div>
  )
}
