import { useState, type FormEvent } from 'react'
import { Phone, User, UserPlus, ChevronDown } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { FamilyMember } from '../../../types'

interface Props {
  sessionId: string
  clinicId:  string
  doctorId:  string
  online:    boolean
  onAdded:   () => void
}

/**
 * Solo mode rapid add bar.
 * Mobile + name → one tap → patient in queue.
 * All DPDP compliance via start_rapid_consultation RPC.
 */
export function RapidAddBar({ sessionId, clinicId, doctorId, online, onAdded }: Props) {
  const [mobile,        setMobile]        = useState('')
  const [name,          setName]          = useState('')
  const [family,        setFamily]        = useState<FamilyMember[] | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [mobileFocused, setMobileFocused] = useState(false)
  const [nameFocused,   setNameFocused]   = useState(false)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!mobile || !name || !online) return
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('start_rapid_consultation', {
      p_clinic_id:  clinicId,
      p_doctor_id:  doctorId,
      p_session_id: sessionId,
      p_mobile:     mobile,
      p_name:       name,
    })

    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }

    const result = data as {
      queue_entry_id: string | null
      patient_id:     string | null
      family_members: FamilyMember[] | null
      needs_reconsent?: boolean
    }

    if (result.family_members && result.family_members.length > 1) {
      setFamily(result.family_members)
      setLoading(false)
      return
    }

    if (result.needs_reconsent) {
      setError('Patient requires updated consent. Please use Add Patient flow.')
      setLoading(false)
      return
    }

    setMobile('')
    setName('')
    setFamily(null)
    setLoading(false)
    onAdded()
  }

  async function selectFamilyMember(patientId: string) {
    setLoading(true)
    const { error: rpcError } = await supabase.rpc('start_rapid_consultation', {
      p_clinic_id:  clinicId,
      p_doctor_id:  doctorId,
      p_session_id: sessionId,
      p_mobile:     mobile,
      p_name:       name,
      p_patient_id: patientId,
    })
    if (rpcError) setError(rpcError.message)
    else { setMobile(''); setName(''); setFamily(null); onAdded() }
    setLoading(false)
  }

  const inputBase = 'w-full rounded-xl pl-8 pr-3 py-2 text-sm transition-all disabled:opacity-50'

  return (
    <div className="border-b px-5 py-3" style={{ borderColor: 'rgba(169,180,183,0.25)', backgroundColor: 'var(--color-surface)' }}>
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3" aria-label="Add patient (rapid mode)">

        {/* Mobile field */}
        <div className="flex flex-col gap-1">
          <label htmlFor="rapidMobile" className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Mobile
          </label>
          <div className="relative">
            <Phone className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} aria-hidden="true" />
            <input
              id="rapidMobile"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              onFocus={() => setMobileFocused(true)}
              onBlur={() => setMobileFocused(false)}
              placeholder="9876543210"
              disabled={!online}
              className={`${inputBase} sm:w-36`}
              style={{
                border: `1.5px solid ${mobileFocused ? 'var(--color-primary)' : 'var(--color-surface-container)'}`,
                backgroundColor: mobileFocused ? 'var(--color-surface)' : 'var(--color-surface-low)',
                color: 'var(--color-ink)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Name field */}
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="rapidName" className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Name
          </label>
          <div className="relative">
            <User className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} aria-hidden="true" />
            <input
              id="rapidName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="Patient name"
              disabled={!online}
              className={inputBase}
              style={{
                border: `1.5px solid ${nameFocused ? 'var(--color-primary)' : 'var(--color-surface-container)'}`,
                backgroundColor: nameFocused ? 'var(--color-surface)' : 'var(--color-surface-low)',
                color: 'var(--color-ink)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Add button */}
        <button
          type="submit"
          disabled={loading || !online || !mobile || !name}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--color-error)' }}>
          ⚠ {error}
        </p>
      )}

      {/* Family member selection */}
      {family && family.length > 1 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>
            <ChevronDown className="h-3 w-3" aria-hidden="true" /> Select member:
          </span>
          {family.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => selectFamilyMember(m.id)}
              className="cursor-pointer rounded-xl border px-2.5 py-1 text-xs font-medium transition-all active:scale-95"
              style={{
                borderColor: 'var(--color-surface-container)',
                color: 'var(--color-ink)',
                backgroundColor: 'var(--color-surface-low)',
              }}
            >
              {m.name}
            </button>
          ))}
          <button type="button" onClick={() => setFamily(null)} className="cursor-pointer text-xs hover:underline" style={{ color: 'var(--color-faded)' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
