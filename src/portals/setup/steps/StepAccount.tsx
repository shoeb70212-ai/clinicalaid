import { useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import type { SetupData } from '../SetupPortal'

const SPECIALTIES = [
  'General Physician', 'Pediatrician', 'Gynecologist', 'Dermatologist',
  'Orthopedic', 'Cardiologist', 'ENT', 'Ophthalmologist', 'Neurologist',
  'Psychiatrist', 'Dentist', 'Ayurveda', 'Homeopathy', 'Other',
]

interface Props {
  data:   Partial<SetupData>
  update: (patch: Partial<SetupData>) => void
  onNext: () => void
}

export function StepAccount({ data, update, onNext }: Props) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!data.email || !data.password || !data.doctorName) return
    setLoading(true)
    setError(null)

    // Create Supabase Auth user
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options:  { data: { name: data.doctorName } },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    update({ staffId: authData.user?.id })
    setLoading(false)
    onNext()
  }

  return (
    <div>
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">
        Create your doctor account
      </h1>
      <p className="mb-6 text-sm text-[#0e7490]">Step 1 of 5</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Full name" htmlFor="doctorName" required>
          <input id="doctorName" type="text" required autoComplete="name"
            value={data.doctorName ?? ''} onChange={(e) => update({ doctorName: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Email address" htmlFor="email" required>
          <input id="email" type="email" required autoComplete="email"
            value={data.email ?? ''} onChange={(e) => update({ email: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Password (min 8 characters, one number)" htmlFor="password" required>
          <input id="password" type="password" required minLength={8} autoComplete="new-password"
            value={data.password ?? ''} onChange={(e) => update({ password: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Mobile number" htmlFor="mobile" required>
          <input id="mobile" type="tel" required autoComplete="tel"
            value={data.mobile ?? ''} onChange={(e) => update({ mobile: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Medical Registration Number (NMC)" htmlFor="regNumber" required>
          <input id="regNumber" type="text" required placeholder="e.g. MH-12345"
            value={data.regNumber ?? ''} onChange={(e) => update({ regNumber: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Qualification" htmlFor="qualification" required>
          <input id="qualification" type="text" required placeholder="MBBS / MD / MS / BDS"
            value={data.qualification ?? ''} onChange={(e) => update({ qualification: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Specialty" htmlFor="specialty" required>
          <select id="specialty" required
            value={data.specialty ?? ''} onChange={(e) => update({ specialty: e.target.value })}
            className={inputCls}>
            <option value="" disabled>Select specialty</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button type="submit" disabled={loading} className={btnCls}>
          {loading ? 'Creating account…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, htmlFor, required, children }: {
  label: string; htmlFor: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[#164e63]">
        {label}{required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = 'rounded-lg border border-gray-200 px-3 py-2 text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]'
const btnCls   = 'cursor-pointer rounded-lg bg-[#059669] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60'
