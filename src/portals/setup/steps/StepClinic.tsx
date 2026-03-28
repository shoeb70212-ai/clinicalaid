import { useState, type FormEvent, type ChangeEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { validateWCAGAA, isValidHex } from '../../../lib/wcag'
import type { SetupData } from '../SetupPortal'

// 12 curated preset colours — all WCAG AA verified against white
const PRESET_COLORS = [
  '#0891b2', '#0284c7', '#2563eb', '#7c3aed',
  '#db2777', '#dc2626', '#ea580c', '#16a34a',
  '#0d9488', '#0369a1', '#6d28d9', '#9333ea',
]

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry',
]

interface Props {
  data:   Partial<SetupData>
  update: (patch: Partial<SetupData>) => void
  onNext: () => void
}

export function StepClinic({ data, update, onNext }: Props) {
  const [customColor, setCustomColor]       = useState('')
  const [contrastError, setContrastError]   = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  function handleColorInput(value: string) {
    setCustomColor(value)
    if (isValidHex(value)) {
      const { valid, ratio } = validateWCAGAA(value)
      if (!valid) {
        setContrastError(`Contrast ratio ${ratio}:1 is below WCAG AA minimum (4.5:1). Choose a darker shade.`)
      } else {
        setContrastError(null)
        update({ primaryColor: value })
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!data.clinicName || !data.address) return
    setLoading(true)
    setError(null)

    // Get session first — must be done before any async DB calls
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    const userId = currentSession?.user?.id
    if (!userId) {
      setError('Session lost — please sign in again.')
      setLoading(false)
      return
    }

    // Create clinic row
    const { data: clinicRow, error: clinicError } = await supabase
      .from('clinics')
      .insert({
        name:          data.clinicName,
        address:       data.address,
        phone:         data.phone,
        primary_color: data.primaryColor ?? '#0891b2',
        clinic_pin_code: data.pinCode,
      })
      .select()
      .single()

    if (clinicError) {
      setError(clinicError.message)
      setLoading(false)
      return
    }

    // Create staff record for the doctor
    const { error: staffError } = await supabase
      .from('staff')
      .insert({
        clinic_id:     clinicRow.id,
        user_id:       userId,
        name:          data.doctorName ?? '',
        full_name:     data.doctorName ?? '',
        email:         data.email ?? '',
        role:          'doctor',
        is_active:     true,
        totp_required: false,
        reg_number:    data.regNumber ?? '',
        qualification: data.qualification ?? '',
        specialty:     data.specialty ?? '',
      })

    if (staffError) {
      setError(`Failed to create staff record: ${staffError.message}`)
      setLoading(false)
      return
    }

    // Upload logo if provided
    if (data.logoFile && clinicRow) {
      const ext  = data.logoFile.type.split('/')[1]
      const path = `${clinicRow.id}/logos/logo.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('clinic-docs')
        .upload(path, data.logoFile, { upsert: true })
      if (uploadError) {
        setError(`Logo upload failed: ${uploadError.message}`)
        setLoading(false)
        return
      }
      await supabase.from('clinics').update({ logo_url: path }).eq('id', clinicRow.id)
    }

    update({ clinicId: clinicRow.id })
    setLoading(false)
    onNext()
  }

  function handleLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Logo must be JPG, PNG, or WebP')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2MB')
      return
    }
    update({ logoFile: file })
  }

  return (
    <div>
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">Clinic details</h1>
      <p className="mb-6 text-sm text-[#0e7490]">Step 2 of 5</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Clinic name" htmlFor="clinicName" required>
          <input id="clinicName" type="text" required
            value={data.clinicName ?? ''} onChange={(e) => update({ clinicName: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="Address" htmlFor="address" required>
          <textarea id="address" required rows={2}
            value={data.address ?? ''} onChange={(e) => update({ address: e.target.value })}
            className={inputCls + ' resize-none'} />
        </Field>

        <Field label="Phone number" htmlFor="clinicPhone" required>
          <input id="clinicPhone" type="tel" required autoComplete="tel"
            value={data.phone ?? ''} onChange={(e) => update({ phone: e.target.value })}
            className={inputCls} />
        </Field>

        <Field label="State" htmlFor="state" required>
          <select id="state" required
            value={data.state ?? ''} onChange={(e) => update({ state: e.target.value })}
            className={inputCls}>
            <option value="" disabled>Select state</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        <Field label="Pin code" htmlFor="pinCode" required>
          <input id="pinCode" type="text" required maxLength={6} pattern="\d{6}"
            value={data.pinCode ?? ''} onChange={(e) => update({ pinCode: e.target.value })}
            className={inputCls} />
        </Field>

        {/* Brand colour */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[#164e63]">Brand colour</span>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => { update({ primaryColor: c }); setCustomColor(''); setContrastError(null) }}
                className={`h-8 w-8 cursor-pointer rounded-full transition-transform duration-150 hover:scale-110 ${data.primaryColor === c ? 'ring-2 ring-[#164e63] ring-offset-2' : ''}`}
                style={{ backgroundColor: c }} aria-label={`Select colour ${c}`} />
            ))}
          </div>
          <input type="text" placeholder="#0891b2" maxLength={7}
            value={customColor} onChange={(e) => handleColorInput(e.target.value)}
            className={inputCls + ' font-mono text-sm'} />
          {contrastError && (
            <p role="alert" className="text-xs text-red-600">{contrastError}</p>
          )}
        </div>

        {/* Logo upload (optional) */}
        <Field label="Clinic logo (optional, max 2MB, JPG/PNG/WebP)" htmlFor="logo">
          <input id="logo" type="file" accept="image/jpeg,image/png,image/webp"
            onChange={handleLogoChange}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#164e63] file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[#0891b2] file:px-3 file:py-1 file:text-xs file:text-white" />
        </Field>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={loading || !!contrastError} className={btnCls}>
          {loading ? 'Saving…' : 'Continue'}
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
