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

type FieldErrors = Partial<Record<'doctorName' | 'email' | 'password' | 'mobile' | 'regNumber' | 'qualification' | 'specialty', string>>

export function StepAccount({ data, update, onNext }: Props) {
  const [loading,     setLoading]     = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [touched,     setTouched]     = useState<Partial<Record<keyof FieldErrors, boolean>>>({})

  function validate(): FieldErrors {
    const errs: FieldErrors = {}
    if (!data.doctorName?.trim())
      errs.doctorName = 'Full name is required.'
    if (!data.email?.trim())
      errs.email = 'Email address is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      errs.email = 'Enter a valid email address.'
    if (!data.password)
      errs.password = 'Password is required.'
    else if (data.password.length < 8)
      errs.password = 'Password must be at least 8 characters.'
    else if (!/\d/.test(data.password))
      errs.password = 'Password must contain at least one number.'
    if (!data.mobile?.trim())
      errs.mobile = 'Mobile number is required.'
    else if (!/^\d{10}$/.test(data.mobile.replace(/\s/g, '')))
      errs.mobile = 'Enter a valid 10-digit mobile number.'
    if (!data.regNumber?.trim())
      errs.regNumber = 'Medical Registration Number is required.'
    if (!data.qualification?.trim())
      errs.qualification = 'Qualification is required.'
    if (!data.specialty)
      errs.specialty = 'Please select a specialty.'
    return errs
  }

  function touch(field: keyof FieldErrors) {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Mark all fields touched so errors show
    setTouched({ doctorName: true, email: true, password: true, mobile: true, regNumber: true, qualification: true, specialty: true })
    const errs = validate()
    if (Object.keys(errs).length > 0) return

    setLoading(true)
    setServerError(null)
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email:    data.email!,
      password: data.password!,
      options:  { data: { name: data.doctorName } },
    })

    if (signUpError) {
      setServerError(signUpError.message)
      setLoading(false)
      return
    }

    update({ staffId: authData.user?.id })
    setLoading(false)
    onNext()
  }

  // Re-validate whenever data changes (only show errors for touched fields)
  const errs = validate()

  function fieldErr(f: keyof FieldErrors) {
    return touched[f] ? errs[f] : undefined
  }

  return (
    <div>
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">
        Create your doctor account
      </h1>
      <p className="mb-6 text-sm text-[#0e7490]">Step 1 of 5</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Full name" htmlFor="doctorName" required error={fieldErr('doctorName')}>
          <input id="doctorName" type="text" autoComplete="name"
            value={data.doctorName ?? ''}
            onChange={(e) => update({ doctorName: e.target.value })}
            onBlur={() => touch('doctorName')}
            className={inputCls(!!fieldErr('doctorName'))} />
        </Field>

        <Field label="Email address" htmlFor="email" required error={fieldErr('email')}>
          <input id="email" type="email" autoComplete="email"
            value={data.email ?? ''}
            onChange={(e) => update({ email: e.target.value })}
            onBlur={() => touch('email')}
            className={inputCls(!!fieldErr('email'))} />
        </Field>

        <Field label="Password (min 8 characters, one number)" htmlFor="password" required error={fieldErr('password')}>
          <input id="password" type="password" autoComplete="new-password"
            value={data.password ?? ''}
            onChange={(e) => update({ password: e.target.value })}
            onBlur={() => touch('password')}
            className={inputCls(!!fieldErr('password'))} />
        </Field>

        <Field label="Mobile number" htmlFor="mobile" required error={fieldErr('mobile')}>
          <input id="mobile" type="tel" autoComplete="tel" placeholder="10-digit number"
            value={data.mobile ?? ''}
            onChange={(e) => update({ mobile: e.target.value })}
            onBlur={() => touch('mobile')}
            className={inputCls(!!fieldErr('mobile'))} />
        </Field>

        <Field label="Medical Registration Number (NMC)" htmlFor="regNumber" required error={fieldErr('regNumber')}>
          <input id="regNumber" type="text" placeholder="e.g. MH-12345"
            value={data.regNumber ?? ''}
            onChange={(e) => update({ regNumber: e.target.value })}
            onBlur={() => touch('regNumber')}
            className={inputCls(!!fieldErr('regNumber'))} />
        </Field>

        <Field label="Qualification" htmlFor="qualification" required error={fieldErr('qualification')}>
          <input id="qualification" type="text" placeholder="MBBS / MD / MS / BDS"
            value={data.qualification ?? ''}
            onChange={(e) => update({ qualification: e.target.value })}
            onBlur={() => touch('qualification')}
            className={inputCls(!!fieldErr('qualification'))} />
        </Field>

        <Field label="Specialty" htmlFor="specialty" required error={fieldErr('specialty')}>
          <select id="specialty"
            value={data.specialty ?? ''}
            onChange={(e) => update({ specialty: e.target.value })}
            onBlur={() => touch('specialty')}
            className={inputCls(!!fieldErr('specialty'))}>
            <option value="" disabled>Select specialty</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        {serverError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
        )}

        {/* Summary shown only after first submit attempt */}
        {Object.values(touched).every(Boolean) && Object.keys(errs).length > 0 && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Please fix {Object.keys(errs).length} error{Object.keys(errs).length > 1 ? 's' : ''} above before continuing.
          </p>
        )}

        <button type="submit" disabled={loading} className={btnCls}>
          {loading ? 'Creating account…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, htmlFor, required, error, children }: {
  label: string; htmlFor: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[#164e63]">
        {label}{required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs text-red-600" role="alert">{error}</p>
      )}
    </div>
  )
}

const inputCls = (hasError: boolean) =>
  `rounded-lg border px-3 py-2 text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] ${
    hasError ? 'border-red-400 bg-red-50' : 'border-gray-200'
  }`
const btnCls = 'cursor-pointer rounded-lg bg-[#059669] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60'
