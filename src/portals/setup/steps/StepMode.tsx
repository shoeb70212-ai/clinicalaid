import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { SetupData } from '../SetupPortal'
import type { ClinicMode } from '../../../types'

interface Props {
  data:   Partial<SetupData>
  update: (patch: Partial<SetupData>) => void
  onNext: () => void
}

export function StepMode({ data, update, onNext }: Props) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function confirm(mode: ClinicMode) {
    if (!data.clinicId) return
    setLoading(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('clinics')
      .update({ clinic_mode: mode })
      .eq('id', data.clinicId)

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    update({ clinicMode: mode })
    setLoading(false)
    onNext()
  }

  return (
    <div>
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">How do you run your clinic?</h1>
      <p className="mb-2 text-sm text-[#0e7490]">Step 3 of 5</p>
      <p className="mb-6 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
        This setting affects how portals work. It can be changed later, but is best decided now.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Solo */}
        <button
          type="button"
          onClick={() => confirm('solo')}
          disabled={loading}
          className={`cursor-pointer rounded-2xl border-2 p-6 text-left transition-all duration-200 hover:border-[#0891b2] hover:shadow-md ${
            data.clinicMode === 'solo' ? 'border-[#0891b2] bg-[#ecfeff]' : 'border-gray-200 bg-white'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <div className="mb-3 text-3xl" aria-hidden="true">👨‍⚕️</div>
          <h2 className="font-['Figtree'] text-lg font-semibold text-[#164e63]">Just Me</h2>
          <p className="mt-1 text-sm text-[#0e7490]">
            I handle everything myself. No reception staff.
          </p>
          <p className="mt-3 text-xs text-gray-400">Best for: solo GP, neighborhood clinic</p>
        </button>

        {/* Team */}
        <button
          type="button"
          onClick={() => confirm('team')}
          disabled={loading}
          className={`cursor-pointer rounded-2xl border-2 p-6 text-left transition-all duration-200 hover:border-[#0891b2] hover:shadow-md ${
            data.clinicMode === 'team' ? 'border-[#0891b2] bg-[#ecfeff]' : 'border-gray-200 bg-white'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <div className="mb-3 text-3xl" aria-hidden="true">👥</div>
          <h2 className="font-['Figtree'] text-lg font-semibold text-[#164e63]">With a Receptionist</h2>
          <p className="mt-1 text-sm text-[#0e7490]">
            I have staff who manage the queue for me.
          </p>
          <p className="mt-3 text-xs text-gray-400">Best for: polyclinic, specialty clinic</p>
        </button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
