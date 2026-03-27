import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
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
  const [mobile,   setMobile]   = useState('')
  const [name,     setName]     = useState('')
  const [family,   setFamily]   = useState<FamilyMember[] | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

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
      // Handle re-consent flow — simplified for V1
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

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-2">
      <form onSubmit={handleAdd} className="flex items-end gap-2" aria-label="Add patient (rapid mode)">
        <div className="flex flex-col gap-0.5">
          <label htmlFor="rapidMobile" className="text-xs text-[#0e7490]">Mobile</label>
          <input id="rapidMobile" type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)}
            placeholder="9876543210" disabled={!online}
            className="w-32 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] disabled:opacity-50" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label htmlFor="rapidName" className="text-xs text-[#0e7490]">Name</label>
          <input id="rapidName" type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Patient name" disabled={!online}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] disabled:opacity-50" />
        </div>
        <button type="submit" disabled={loading || !online || !mobile || !name}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#0891b2] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#0e7490] disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add
        </button>
      </form>

      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}

      {/* Family member selection */}
      {family && family.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="text-xs text-[#0e7490]">Select:</span>
          {family.map((m) => (
            <button key={m.id} type="button" onClick={() => selectFamilyMember(m.id)}
              className="cursor-pointer rounded-lg border border-gray-200 px-2 py-1 text-xs text-[#164e63] transition-colors hover:bg-[#ecfeff]">
              {m.name}
            </button>
          ))}
          <button type="button" onClick={() => setFamily(null)}
            className="cursor-pointer text-xs text-gray-400 hover:underline">Cancel</button>
        </div>
      )}
    </div>
  )
}
