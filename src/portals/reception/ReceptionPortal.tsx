import { useState, useEffect, useRef } from 'react'
import { LogOut, RefreshCw, Calendar, Bell, BarChart2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useSession } from '../../hooks/useSession'
import { useQueue } from '../../hooks/useQueue'
import { useInactivityLogout } from '../../hooks/useInactivityLogout'
import { OfflineBanner } from '../../components/shared/OfflineBanner'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { QueuePanel } from './components/QueuePanel'
import { AddPatientPanel } from './components/AddPatientPanel'
import { AppointmentPanel } from './components/AppointmentPanel'
import { RecallPanel } from './components/RecallPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { SessionControls } from './components/SessionControls'
import { ZReport } from './components/ZReport'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

export default function ReceptionPortal() {
  useInactivityLogout(30 * 60 * 1000) // 30 min

  const { staff, clinic, signOut } = useAuth()
  const online = useConnectionStatus()

  // Apply clinic's brand color to CSS variable so bg-clinic / text-clinic utilities work
  useEffect(() => {
    if (clinic?.primary_color) {
      document.documentElement.style.setProperty('--color-clinic', clinic.primary_color)
    }
  }, [clinic?.primary_color])

  // Query by clinic_id so receptionists in team mode find the doctor's session.
  const { session, loading: sessionLoading, refetch: refetchSession } = useSession(null, clinic?.id ?? null)
  const { queue,   loading: queueLoading,   refetch: refetchQueue   } = useQueue(session?.id ?? null)

  type SidePanel = 'appointments' | 'recall' | 'analytics' | null
  const [activePanel,      setActivePanel]      = useState<SidePanel>(null)
  const [showAddPatient,   setShowAddPatient]   = useState(false)
  const [zReportSessionId, setZReportSessionId] = useState<string | null>(null)

  const showAppointments = activePanel === 'appointments'
  const showRecall       = activePanel === 'recall'
  const showAnalytics    = activePanel === 'analytics'
  // Capture session ID before close so Z-Report can be shown after session disappears
  const closingSessionIdRef = useRef<string | null>(null)

  // Show Z-Report when a session transitions from active to closed/gone
  useEffect(() => {
    if (!sessionLoading && !session && closingSessionIdRef.current) {
      setZReportSessionId(closingSessionIdRef.current)
      closingSessionIdRef.current = null
    }
  }, [session, sessionLoading])

  function handleSessionChange() {
    closingSessionIdRef.current = session?.id ?? null
    refetchSession()
  }

  if (sessionLoading) return <LoadingSpinner fullScreen />

  return (
    <div className="flex h-screen flex-col bg-[#ecfeff]">
      <OfflineBanner />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          {clinic?.logo_url && (
            <img
              src={supabase.storage.from('clinic-docs').getPublicUrl(clinic.logo_url).data.publicUrl}
              alt={`${clinic.name} logo`}
              className="h-8 w-8 rounded object-contain"
            />
          )}
          <div>
            <h1 className="font-['Figtree'] text-lg font-semibold text-[#164e63]">{clinic?.name}</h1>
            <p className="text-xs text-[#0e7490]">Reception — {staff?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Online indicator */}
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`}
            aria-label={online ? 'Live' : 'Offline'} title={online ? 'Live' : 'Offline'} />
          <button onClick={() => { refetchSession(); refetchQueue() }}
            aria-label="Refresh queue"
            className="cursor-pointer rounded-lg p-2 text-[#0e7490] transition-colors hover:bg-[#ecfeff]">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button onClick={() => setActivePanel(showAppointments ? null : 'appointments')}
            aria-label="Appointments"
            aria-pressed={showAppointments}
            className={`cursor-pointer rounded-lg p-2 transition-colors ${showAppointments ? 'bg-[#e0f4f4] text-[#006a6a]' : 'text-[#0e7490] hover:bg-[#ecfeff]'}`}>
            <Calendar className="h-4 w-4" aria-hidden="true" />
          </button>
          {clinic?.config?.recall_engine_enabled && (
            <button onClick={() => setActivePanel(showRecall ? null : 'recall')}
              aria-label="Patient recall"
              aria-pressed={showRecall}
              className={`cursor-pointer rounded-lg p-2 transition-colors ${showRecall ? 'bg-[#fef9f0] text-[#b45309]' : 'text-[#0e7490] hover:bg-[#ecfeff]'}`}>
              <Bell className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button onClick={() => setActivePanel(showAnalytics ? null : 'analytics')}
            aria-label="Analytics"
            aria-pressed={showAnalytics}
            className={`cursor-pointer rounded-lg p-2 transition-colors ${showAnalytics ? 'bg-[#e0f4f4] text-[#006a6a]' : 'text-[#0e7490] hover:bg-[#ecfeff]'}`}>
            <BarChart2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button onClick={signOut} aria-label="Sign out"
            className="cursor-pointer rounded-lg p-2 text-[#0e7490] transition-colors hover:bg-[#ecfeff]">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Session controls bar */}
      <SessionControls
        session={session}
        clinicId={clinic?.id ?? ''}
        doctorId={staff?.id ?? ''}
        onSessionChange={handleSessionChange}
      />

      {/* Main content */}
      <main id="main-content" className="flex flex-1 overflow-hidden">
        {/* Queue area */}
        <div className={`flex flex-col overflow-hidden ${(showAppointments || showRecall || showAnalytics) ? 'hidden md:flex md:w-3/5' : 'flex-1'}`}>
          {session ? (
            <>
              {/* Queue panel — full width or split with add patient */}
              <div className={`flex flex-col ${showAddPatient ? 'md:w-3/5' : ''} w-full overflow-hidden flex-1`}>
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
                  <h2 className="font-['Figtree'] font-semibold text-[#164e63]">
                    Queue
                    {!queueLoading && (
                      <span className="ml-2 rounded-full bg-[#0891b2] px-2 py-0.5 text-xs text-white">
                        {queue.filter((q) => ['CHECKED_IN', 'CALLED'].includes(q.status)).length}
                      </span>
                    )}
                  </h2>
                  <button
                    onClick={() => setShowAddPatient((v) => !v)}
                    disabled={!online}
                    className="cursor-pointer rounded-lg bg-[#0891b2] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[#0e7490] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {showAddPatient ? 'Close' : '+ Add Patient'}
                  </button>
                </div>

                {queueLoading
                  ? <LoadingSpinner />
                  : <QueuePanel
                      queue={queue}
                      sessionId={session.id}
                      clinicId={clinic?.id ?? ''}
                      staffRole={staff?.role ?? 'receptionist'}
                      online={online}
                      onUpdate={refetchQueue}
                    />
                }
              </div>

              {/* Add patient panel — full-screen overlay on mobile, side panel on desktop */}
              {showAddPatient && (
                <div className="fixed inset-0 z-40 overflow-y-auto bg-white md:relative md:inset-auto md:z-auto md:w-2/5 md:border-l md:border-gray-200">
                  <AddPatientPanel
                    sessionId={session.id}
                    clinicId={clinic?.id ?? ''}
                    onAdded={() => { refetchQueue(); setShowAddPatient(false) }}
                    onClose={() => setShowAddPatient(false)}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-8">
              <p className="text-xl font-['Figtree'] font-semibold text-[#164e63]">No active session</p>
              <p className="text-sm text-[#0e7490]">Open a session to start accepting patients.</p>
            </div>
          )}
        </div>

        {/* Appointments panel — full-screen overlay on mobile, side panel on desktop */}
        {showAppointments && (
          <div className="fixed inset-0 z-30 overflow-y-auto bg-white md:relative md:inset-auto md:z-auto md:flex md:w-2/5 md:flex-col md:border-l md:border-gray-200">
            <AppointmentPanel
              clinicId={clinic?.id ?? ''}
              doctorId={session?.doctor_id ?? ''}
              online={online}
            />
          </div>
        )}

        {/* Recall panel — full-screen overlay on mobile, side panel on desktop */}
        {showRecall && clinic?.config?.recall_engine_enabled && (
          <div className="fixed inset-0 z-30 overflow-y-auto bg-white md:relative md:inset-auto md:z-auto md:flex md:w-2/5 md:flex-col md:border-l md:border-gray-200">
            <RecallPanel
              clinicId={clinic?.id ?? ''}
              sessionId={session?.id ?? null}
              online={online}
              onQueued={refetchQueue}
            />
          </div>
        )}

        {/* Analytics panel — full-screen overlay on mobile, side panel on desktop */}
        {showAnalytics && (
          <div className="fixed inset-0 z-30 overflow-y-auto bg-white md:relative md:inset-auto md:z-auto md:flex md:w-2/5 md:flex-col md:border-l md:border-gray-200">
            <AnalyticsPanel clinicId={clinic?.id ?? ''} />
          </div>
        )}
      </main>

      {/* Z-Report modal — shown after session is closed */}
      {zReportSessionId && (
        <ZReport
          sessionId={zReportSessionId}
          onClose={() => setZReportSessionId(null)}
        />
      )}
    </div>
  )
}
