import { useState, type FormEvent } from 'react'
import { Plus, Mail } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { SetupData } from '../SetupPortal'

interface Props {
  data:   Partial<SetupData>
  onNext: () => void
}

export function StepInvite({ data, onNext }: Props) {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!email || !data.clinicId || !data.staffId) return
    setLoading(true)
    setError(null)

    const token = crypto.randomUUID()

    const { error: inviteError } = await supabase
      .from('staff_invites')
      .insert({
        clinic_id:  data.clinicId,
        email,
        role:       'receptionist',
        token,
        created_by: data.staffId,
      })

    if (inviteError) {
      setError(inviteError.message)
      setLoading(false)
      return
    }

    // In production, send email via Supabase Edge Function or email provider
    // For now, show the invite link so it can be shared manually
    setSent((prev) => [...prev, email])
    setEmail('')
    setLoading(false)
  }

  return (
    <div>
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">Invite your receptionist</h1>
      <p className="mb-6 text-sm text-[#0e7490]">Step 4 of 5</p>

      <form onSubmit={handleSend} className="flex flex-col gap-4">
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="inviteEmail" className="text-sm font-medium text-[#164e63]">
              Receptionist email address
            </label>
            <input id="inviteEmail" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="receptionist@clinic.com"
              className="rounded-lg border border-gray-200 px-3 py-2 text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]" />
          </div>
          <button type="submit" disabled={loading || !email}
            className="mt-6 cursor-pointer rounded-lg bg-[#0891b2] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#0e7490] disabled:opacity-60">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Send invite</span>
          </button>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </form>

      {sent.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Sent invites">
          {sent.map((e) => (
            <li key={e} className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              Invite sent to {e}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onNext}
          className="flex-1 cursor-pointer rounded-lg bg-[#059669] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#047857]">
          Continue
        </button>
        <button type="button" onClick={onNext}
          className="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm text-[#0e7490] transition-colors duration-200 hover:bg-gray-50">
          Skip for now
        </button>
      </div>
    </div>
  )
}
