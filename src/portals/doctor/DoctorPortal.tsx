import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useSession } from '../../hooks/useSession'
import { useQueue } from '../../hooks/useQueue'
import { useInactivityLogout } from '../../hooks/useInactivityLogout'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { OfflineBanner } from '../../components/shared/OfflineBanner'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { DoctorQueueSidebar } from './components/DoctorQueueSidebar'
import { ConsultationPanel } from './components/ConsultationPanel'
import { RapidAddBar } from './components/RapidAddBar'
import { SessionControls } from '../reception/components/SessionControls'
import type { QueueEntryWithPatient } from '../../types'

export default function DoctorPortal() {
  useInactivityLogout(15 * 60 * 1000) // 15 min

  const { staff, clinic, signOut } = useAuth()
  const online = useConnectionStatus()
  const isSolo = clinic?.clinic_mode === 'solo'

  const { session, loading: sessionLoading, refetch: refetchSession } = useSession(staff?.id ?? null)
  const { queue,   loading: queueLoading,   refetch: refetchQueue   } = useQueue(session?.id ?? null)

  const [activeEntry, setActiveEntry] = useState<QueueEntryWithPatient | null>(null)

  if (sessionLoading) return <LoadingSpinner fullScreen />

  const inConsultation = queue.find((e) => e.status === 'IN_CONSULTATION') ?? null

  // Auto-select in-consultation patient
  const displayEntry = activeEntry ?? inConsultation

  return (
    <div className="flex h-screen flex-col bg-[#ecfeff]">
      <OfflineBanner />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          {clinic?.logo_url && (
            <img src={clinic.logo_url} alt={`${clinic.name} logo`} className="h-8 w-8 rounded object-contain" />
          )}
          <div>
            <h1 className="font-['Figtree'] text-lg font-semibold text-[#164e63]">{clinic?.name}</h1>
            <p className="text-xs text-[#0e7490]">Dr. {staff?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`}
            aria-label={online ? 'Live' : 'Offline'} />
          <button onClick={signOut} aria-label="Sign out"
            className="cursor-pointer rounded-lg p-2 text-[#0e7490] transition-colors hover:bg-[#ecfeff]">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Rapid mode add bar (solo only) */}
      {isSolo && session && (
        <RapidAddBar
          sessionId={session.id}
          clinicId={clinic?.id ?? ''}
          doctorId={staff?.id ?? ''}
          online={online}
          onAdded={refetchQueue}
        />
      )}

      {/* Session controls */}
      <SessionControls
        session={session}
        clinicId={clinic?.id ?? ''}
        doctorId={staff?.id ?? ''}
        onSessionChange={refetchSession}
      />

      {/* Main: sidebar + consultation panel */}
      <main id="main-content" className="flex flex-1 overflow-hidden">
        {session ? (
          <>
            {/* Queue sidebar */}
            <aside className="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
              {queueLoading
                ? <LoadingSpinner />
                : <DoctorQueueSidebar
                    queue={queue}
                    activeId={displayEntry?.id ?? null}
                    onSelect={setActiveEntry}
                  />
              }
            </aside>

            {/* Consultation panel */}
            <div className="flex-1 overflow-hidden">
              {displayEntry
                ? <ConsultationPanel
                    entry={displayEntry}
                    clinicId={clinic?.id ?? ''}
                    doctorId={staff?.id ?? ''}
                    staffId={staff?.id ?? ''}
                    online={online}
                    onUpdate={() => { refetchQueue(); setActiveEntry(null) }}
                  />
                : (
                  <div className="flex h-full items-center justify-center text-center p-8">
                    <div>
                      <p className="font-['Figtree'] text-xl font-semibold text-[#164e63]">No active consultation</p>
                      <p className="mt-1 text-sm text-[#0e7490]">Call the next patient to begin.</p>
                    </div>
                  </div>
                )
              }
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <p className="font-['Figtree'] text-xl font-semibold text-[#164e63]">No active session</p>
              <p className="mt-1 text-sm text-[#0e7490]">Open a session above to start seeing patients.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
