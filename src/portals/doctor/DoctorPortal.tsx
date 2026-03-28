import { useState, useCallback, useMemo, useEffect } from 'react'
import { LogOut, Menu, X, Stethoscope, Clock, Moon, Sun } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useSession } from '../../hooks/useSession'
import { useQueue } from '../../hooks/useQueue'
import { useInactivityLogout } from '../../hooks/useInactivityLogout'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { useDarkMode } from '../../hooks/useDarkMode'
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
  const { dark, toggle: toggleDark } = useDarkMode()
  const isSolo = clinic?.clinic_mode === 'solo'

  const { session, loading: sessionLoading, refetch: refetchSession } = useSession(staff?.id ?? null)
  const { queue,   loading: queueLoading,   refetch: refetchQueue   } = useQueue(session?.id ?? null)

  const [activeEntry, setActiveEntry] = useState<QueueEntryWithPatient | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSelectEntry = useCallback((entry: QueueEntryWithPatient) => {
    setActiveEntry(entry)
    setSidebarOpen(false)
  }, [])

  // Apply clinic's brand color to CSS variable so bg-clinic / text-clinic utilities work
  useEffect(() => {
    if (clinic?.primary_color) {
      document.documentElement.style.setProperty('--color-clinic', clinic.primary_color)
    }
  }, [clinic?.primary_color])

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  const inConsultation = useMemo(
    () => queue.find((e) => e.status === 'IN_CONSULTATION') ?? null,
    [queue],
  )

  // Reconcile activeEntry with the latest queue data after every realtime update.
  // Prevents OCC conflicts from stale version numbers when doctor selects a patient
  // and then the queue updates in the background.
  useEffect(() => {
    if (!activeEntry) return
    const fresh = queue.find((e) => e.id === activeEntry.id)
    if (fresh && fresh.version !== activeEntry.version) {
      setActiveEntry(fresh)
    }
  }, [queue, activeEntry])

  const displayEntry = activeEntry ?? inConsultation

  if (sessionLoading) return <LoadingSpinner fullScreen />

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: '#f8fafb' }}>
      <OfflineBanner />

      {/* Header */}
      <header className="flex items-center justify-between bg-white px-5 py-3.5" style={{ boxShadow: '0 1px 0 rgba(42,52,55,0.08)' }}>
        <div className="flex items-center gap-3">
          {clinic?.logo_url ? (
            <img
              src={supabase.storage.from('clinic-docs').getPublicUrl(clinic.logo_url).data.publicUrl}
              alt={`${clinic.name} logo`}
              className="h-8 w-8 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: '#e0f4f4' }}>
              <Stethoscope className="h-4 w-4" style={{ color: '#006a6a' }} aria-hidden="true" />
            </div>
          )}
          <div>
            <h1 className="text-sm font-semibold leading-tight" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>
              {clinic?.name}
            </h1>
            <p className="text-xs" style={{ color: '#006a6a' }}>Dr. {staff?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-400'}`}
            aria-label={online ? 'Live' : 'Offline'}
          />
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle queue"
            className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-[#f0f4f6] md:hidden"
            style={{ color: '#566164' }}
          >
            {sidebarOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
          <button
            onClick={toggleDark}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-[#f0f4f6]"
            style={{ color: '#566164' }}
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-[#f0f4f6]"
            style={{ color: '#566164' }}
          >
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

      {/* Main */}
      <main id="main-content" className="flex flex-1 overflow-hidden">
        {session ? (
          <>
            {/* Mobile backdrop */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 z-30 md:hidden"
                style={{ backgroundColor: 'rgba(42,52,55,0.3)' }}
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Queue sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto bg-white transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:z-auto md:w-56 md:translate-x-0 md:transition-none`}
              style={{ borderRight: '1px solid rgba(169,180,183,0.2)' }}>
              {queueLoading
                ? <LoadingSpinner />
                : <DoctorQueueSidebar
                    queue={queue}
                    activeId={displayEntry?.id ?? null}
                    onSelect={handleSelectEntry}
                    avgSeconds={clinic?.config?.avg_consultation_seconds ?? 600}
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
                    doctorName={staff?.name}
                    specialty={staff?.specialty}
                    regNumber={staff?.reg_number}
                    clinicName={clinic?.name}
                    clinicAddress={clinic?.address}
                    clinicPhone={clinic?.phone}
                  />
                : (
                  <div className="flex h-full items-center justify-center p-8">
                    <div className="text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: '#e0f4f4' }}>
                        <Stethoscope className="h-8 w-8" style={{ color: '#006a6a' }} aria-hidden="true" />
                      </div>
                      <p className="text-base font-semibold" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>
                        No active consultation
                      </p>
                      <p className="mt-1 text-sm" style={{ color: '#566164' }}>
                        Select a patient from the queue to begin.
                      </p>
                    </div>
                  </div>
                )
              }
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: '#e0f4f4' }}>
                <Clock className="h-8 w-8" style={{ color: '#006a6a' }} aria-hidden="true" />
              </div>
              <p className="text-base font-semibold" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>
                No active session
              </p>
              <p className="mt-1 text-sm" style={{ color: '#566164' }}>
                Open a session above to start seeing patients.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
