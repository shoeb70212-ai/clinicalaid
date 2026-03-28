import { useState } from 'react'
import { Play, Pause, Square } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Session } from '../../../types'

interface Props {
  session:         Session | null
  clinicId:        string
  doctorId:        string
  onSessionChange: () => void
}

export function SessionControls({ session, clinicId, doctorId, onSessionChange }: Props) {
  const [loading,      setLoading]      = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  async function openSession() {
    if (!clinicId || !doctorId) return
    setLoading(true)
    setSessionError(null)

    // Atomic: creates session + session_counters in one DB transaction
    const { error } = await supabase.rpc('open_session', {
      p_clinic_id: clinicId,
      p_doctor_id: doctorId,
    })

    setLoading(false)
    if (error) {
      setSessionError(error.message)
      return
    }
    onSessionChange()
  }

  async function updateStatus(status: 'paused' | 'closed') {
    if (!session) return
    setLoading(true)
    setConfirmClose(false)
    setSessionError(null)

    const { error } = await supabase
      .from('sessions')
      .update({ status })
      .eq('id', session.id)

    setLoading(false)
    if (error) {
      setSessionError(`Could not ${status === 'paused' ? 'pause' : 'close'} session: ${error.message}`)
    } else {
      onSessionChange()
    }
  }

  const statusColors: Record<string, string> = {
    open:   'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    closed: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-2 flex-wrap">
      {sessionError && (
        <span className="text-xs text-red-600">{sessionError}</span>
      )}
      {session ? (
        <>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[session.status] ?? ''}`}>
            Session {session.status}
          </span>
          {session.status === 'open' && (
            <button onClick={() => updateStatus('paused')} disabled={loading}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-200 px-3 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-60">
              <Pause className="h-3 w-3" aria-hidden="true" /> Pause
            </button>
          )}
          {session.status === 'paused' && (
            <button onClick={openSession} disabled={loading}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-green-200 px-3 py-1 text-xs text-green-700 transition-colors hover:bg-green-50 disabled:opacity-60">
              <Play className="h-3 w-3" aria-hidden="true" /> Resume
            </button>
          )}
          {session.status !== 'closed' && !confirmClose && (
            <button onClick={() => setConfirmClose(true)} disabled={loading}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60">
              <Square className="h-3 w-3" aria-hidden="true" /> Close Session
            </button>
          )}
          {confirmClose && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">Close session? This cannot be undone.</span>
              <button onClick={() => updateStatus('closed')} disabled={loading}
                className="cursor-pointer rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
                Confirm
              </button>
              <button onClick={() => setConfirmClose(false)}
                className="cursor-pointer text-xs text-gray-400 hover:underline">
                Cancel
              </button>
            </div>
          )}
        </>
      ) : (
        <button onClick={openSession} disabled={loading}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#059669] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#047857] disabled:opacity-60">
          <Play className="h-4 w-4" aria-hidden="true" /> Open Session
        </button>
      )}
    </div>
  )
}
