import { useState, useEffect, useCallback } from 'react'
import { Calendar, Plus, X, Clock, User, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Appointment, Patient } from '../../../types'

interface Props {
  clinicId: string
  doctorId: string
  online:   boolean
}

const TYPE_LABELS: Record<string, string> = {
  regular:   'Regular',
  follow_up: 'Follow-up',
  urgent:    'Urgent',
}

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  booked:    { color: '#006a6a', bg: '#e0f4f4' },
  completed: { color: '#166534', bg: '#dcfce7' },
  cancelled: { color: '#991b1b', bg: '#fee2e2' },
  no_show:   { color: '#6b7280', bg: '#f3f4f6' },
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

export function AppointmentPanel({ clinicId, doctorId, online }: Props) {
  const [selectedDate, setSelectedDate] = useState<string>(toDateStr(new Date()))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showBook,     setShowBook]     = useState(false)

  // Booking form
  const [mobileSearch, setMobileSearch]   = useState('')
  const [patients,     setPatients]       = useState<Patient[]>([])
  const [selectedPat,  setSelectedPat]    = useState<Patient | null>(null)
  const [time,         setTime]           = useState('09:00')
  const [duration,     setDuration]       = useState('15')
  const [apptType,     setApptType]       = useState('regular')
  const [notes,        setNotes]          = useState('')
  const [bookError,    setBookError]      = useState<string | null>(null)
  const [booking,      setBooking]        = useState(false)

  const fetchAppointments = useCallback(async () => {
    setLoading(true)
    const start = `${selectedDate}T00:00:00`
    const end   = `${selectedDate}T23:59:59`

    const { data } = await supabase
      .from('appointments')
      .select('*, patient:patients(id, name, mobile)')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .neq('status', 'cancelled')
      .order('scheduled_at')

    setAppointments((data ?? []) as Appointment[])
    setLoading(false)
  }, [clinicId, doctorId, selectedDate])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])

  async function searchPatients() {
    if (!mobileSearch.trim()) return
    const { data } = await supabase
      .from('patients')
      .select('id, name, mobile, dob, gender')
      .eq('clinic_id', clinicId)
      .ilike('mobile', `%${mobileSearch}%`)
      .limit(10)
    setPatients((data ?? []) as Patient[])
  }

  async function handleBook() {
    if (!selectedPat) { setBookError('Select a patient'); return }
    setBooking(true)
    setBookError(null)

    const scheduledAt = new Date(`${selectedDate}T${time}:00`)

    const { error } = await supabase.rpc('book_appointment', {
      p_clinic_id:        clinicId,
      p_patient_id:       selectedPat.id,
      p_doctor_id:        doctorId,
      p_scheduled_at:     scheduledAt.toISOString(),
      p_duration_mins:    parseInt(duration),
      p_appointment_type: apptType,
      p_notes:            notes || null,
    })

    if (error) {
      setBookError(error.message)
      setBooking(false)
      return
    }

    // reset form
    setMobileSearch('')
    setPatients([])
    setSelectedPat(null)
    setTime('09:00')
    setDuration('15')
    setApptType('regular')
    setNotes('')
    setShowBook(false)
    setBooking(false)
    fetchAppointments()
  }

  async function handleCancel(id: string) {
    await supabase.rpc('cancel_appointment', {
      p_appointment_id: id,
      p_clinic_id:      clinicId,
    })
    fetchAppointments()
  }

  function shiftDate(days: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    setSelectedDate(toDateStr(d))
  }

  const displayDate = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'rgba(169,180,183,0.2)', backgroundColor: '#fff' }}>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" style={{ color: '#006a6a' }} />
          <span className="text-sm font-bold" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
            Appointments
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowBook((v) => !v)}
          disabled={!online}
          className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}
        >
          <Plus className="h-3.5 w-3.5" /> Book
        </button>
      </div>

      {/* Date navigator */}
      <div className="flex items-center justify-between px-4 py-2"
        style={{ backgroundColor: '#f8fafb', borderBottom: '1px solid rgba(169,180,183,0.15)' }}>
        <button type="button" onClick={() => shiftDate(-1)}
          className="cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-white">
          <ChevronLeft className="h-4 w-4" style={{ color: '#566164' }} />
        </button>
        <p className="text-xs font-semibold" style={{ color: '#2a3437' }}>{displayDate}</p>
        <button type="button" onClick={() => shiftDate(1)}
          className="cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-white">
          <ChevronRight className="h-4 w-4" style={{ color: '#566164' }} />
        </button>
      </div>

      {/* Book form */}
      {showBook && (
        <div className="border-b p-4" style={{ backgroundColor: '#e0f4f4', borderColor: 'rgba(169,180,183,0.2)' }}>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: '#566164' }}>
            New Appointment
          </p>

          {/* Patient search */}
          {!selectedPat ? (
            <div className="mb-3">
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={mobileSearch}
                  onChange={(e) => setMobileSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchPatients()}
                  placeholder="Search by mobile…"
                  className="flex-1 rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={{ backgroundColor: '#fff', border: '1.5px solid #d9e4e8', color: '#2a3437' }}
                />
                <button type="button" onClick={searchPatients}
                  className="cursor-pointer rounded-xl px-3 py-2 text-xs font-bold text-white"
                  style={{ backgroundColor: '#006a6a' }}>
                  Search
                </button>
              </div>
              {patients.length > 0 && (
                <ul className="mt-2 rounded-xl overflow-hidden border" style={{ borderColor: '#d9e4e8' }}>
                  {patients.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => { setSelectedPat(p); setPatients([]) }}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white">
                        <User className="h-3.5 w-3.5 shrink-0" style={{ color: '#006a6a' }} />
                        <span style={{ color: '#2a3437' }}>{p.name}</span>
                        <span className="text-xs" style={{ color: '#a9b4b7' }}>{p.mobile}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mb-3 flex items-center justify-between rounded-xl px-3 py-2"
              style={{ backgroundColor: '#fff' }}>
              <div>
                <p className="text-sm font-bold" style={{ color: '#2a3437' }}>{selectedPat.name}</p>
                <p className="text-xs" style={{ color: '#566164' }}>{selectedPat.mobile}</p>
              </div>
              <button type="button" onClick={() => setSelectedPat(null)}
                className="cursor-pointer rounded-lg p-1 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Time + duration + type */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase" style={{ color: '#566164' }}>Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl px-2 py-1.5 text-sm focus:outline-none"
                style={{ backgroundColor: '#fff', border: '1.5px solid #d9e4e8', color: '#2a3437' }} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase" style={{ color: '#566164' }}>Mins</label>
              <input type="number" min="5" step="5" value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full rounded-xl px-2 py-1.5 text-sm focus:outline-none"
                style={{ backgroundColor: '#fff', border: '1.5px solid #d9e4e8', color: '#2a3437' }} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase" style={{ color: '#566164' }}>Type</label>
              <select value={apptType} onChange={(e) => setApptType(e.target.value)}
                className="w-full cursor-pointer rounded-xl px-2 py-1.5 text-sm focus:outline-none"
                style={{ backgroundColor: '#fff', border: '1.5px solid #d9e4e8', color: '#2a3437' }}>
                <option value="regular">Regular</option>
                <option value="follow_up">Follow-up</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Notes (optional)…"
            className="mb-3 w-full resize-none rounded-xl px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: '#fff', border: '1.5px solid #d9e4e8', color: '#2a3437' }} />

          {bookError && <p className="mb-2 text-xs text-red-600">{bookError}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={handleBook} disabled={booking || !online}
              className="flex-1 cursor-pointer rounded-xl py-2 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}>
              {booking ? 'Booking…' : 'Confirm Booking'}
            </button>
            <button type="button" onClick={() => setShowBook(false)}
              className="cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: '#d9e4e8', color: '#566164', backgroundColor: '#fff' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Appointment list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-xs" style={{ color: '#a9b4b7' }}>Loading…</p>
        ) : appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: '#e0f4f4' }}>
              <Calendar className="h-5 w-5" style={{ color: '#006a6a' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#566164' }}>No appointments today</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {appointments.map((appt) => {
              const t       = new Date(appt.scheduled_at)
              const timeStr = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
              const style   = STATUS_STYLE[appt.status] ?? STATUS_STYLE.booked

              return (
                <div key={appt.id}
                  className="flex items-start gap-3 rounded-xl p-3"
                  style={{ backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(42,52,55,0.06)' }}>
                  {/* Time column */}
                  <div className="flex w-14 shrink-0 flex-col items-center">
                    <Clock className="h-3.5 w-3.5 mb-0.5" style={{ color: '#a9b4b7' }} />
                    <p className="text-[11px] font-bold tabular-nums" style={{ color: '#006a6a' }}>{timeStr}</p>
                    <p className="text-[10px]" style={{ color: '#a9b4b7' }}>{appt.duration_mins}m</p>
                  </div>

                  {/* Patient info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
                      {appt.patient?.name ?? '—'}
                    </p>
                    <p className="text-xs" style={{ color: '#566164' }}>
                      {appt.patient?.mobile}
                    </p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: style.bg, color: style.color }}>
                        {appt.status}
                      </span>
                      <span className="text-[10px]" style={{ color: '#a9b4b7' }}>
                        {TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type}
                      </span>
                    </div>
                    {appt.notes && (
                      <p className="mt-1 text-xs" style={{ color: '#566164' }}>{appt.notes}</p>
                    )}
                  </div>

                  {/* Cancel button */}
                  {appt.status === 'booked' && online && (
                    <button type="button" onClick={() => handleCancel(appt.id)}
                      className="shrink-0 cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-red-50"
                      aria-label="Cancel appointment">
                      <X className="h-3.5 w-3.5" style={{ color: '#dc2626' }} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
