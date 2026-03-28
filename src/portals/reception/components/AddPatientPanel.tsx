import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { FamilyMember } from '../../../types'

interface Props {
  sessionId: string
  clinicId:  string
  onAdded:   () => void
  onClose:   () => void
}

export function AddPatientPanel({ sessionId, clinicId, onAdded, onClose }: Props) {
  const [mobile,        setMobile]        = useState('')
  const [name,          setName]          = useState('')
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[] | null>(null)
  const [step,          setStep]          = useState<'search' | 'select' | 'new' | 'consent'>('search')
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [consentText,   setConsentText]   = useState('')
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  async function handleMobileSearch(e: FormEvent) {
    e.preventDefault()
    if (!mobile) return
    setLoading(true)
    setError(null)

    // Look up existing patients by mobile — always returns array (families share phones)
    const { data } = await supabase
      .from('patients')
      .select('id, name, dob')
      .eq('clinic_id', clinicId)
      .eq('mobile', mobile)
      .eq('is_anonymized', false)

    if (data && data.length > 1) {
      setFamilyMembers(data as FamilyMember[])
      setStep('select')
    } else if (data && data.length === 1) {
      await checkConsentAndQueue(data[0].id)
    } else {
      setStep('new')
    }
    setLoading(false)
  }

  async function checkConsentAndQueue(patientId: string) {
    setSelectedId(patientId)

    // Get current consent version
    const { data: clinicData } = await supabase
      .from('clinics')
      .select('config')
      .eq('id', clinicId)
      .single()

    const consentVersion = clinicData?.config?.consent_version ?? 'v1.0'

    // Check if valid consent exists
    const { data: consent } = await supabase
      .from('patient_consents')
      .select('id')
      .eq('patient_id', patientId)
      .eq('clinic_id', clinicId)
      .eq('consent_version', consentVersion)
      .eq('is_withdrawn', false)
      .limit(1)
      .maybeSingle()

    if (!consent) {
      // Need to capture consent
      const { data: tmpl } = await supabase
        .from('consent_templates')
        .select('content')
        .or(`clinic_id.eq.${clinicId},clinic_id.is.null`)
        .eq('version', consentVersion)
        .eq('language', 'en')
        .order('clinic_id', { nullsFirst: false })
        .limit(1)
        .maybeSingle()

      setConsentText(tmpl?.content ?? '')
      setStep('consent')
    } else {
      await addToQueue(patientId)
    }
  }

  async function createNewPatient() {
    if (!name || !mobile) return
    setLoading(true)

    // Get consent template
    const { data: clinicData } = await supabase
      .from('clinics').select('config').eq('id', clinicId).single()
    const consentVersion = clinicData?.config?.consent_version ?? 'v1.0'

    const { data: tmpl } = await supabase
      .from('consent_templates')
      .select('content')
      .or(`clinic_id.eq.${clinicId},clinic_id.is.null`)
      .eq('version', consentVersion)
      .eq('is_active', true)
      .order('clinic_id', { nullsFirst: false })
      .limit(1)
      .maybeSingle()

    // Create patient + consent in one transaction via RPC
    const { data: result, error: rpcError } = await supabase.rpc('create_new_patient', {
      p_clinic_id:       clinicId,
      p_name:            name,
      p_mobile:          mobile,
      p_consent_text:    tmpl?.content ?? '',
      p_consent_version: consentVersion,
    })

    if (rpcError) { setError(rpcError.message); setLoading(false); return }

    await addToQueue((result as { patient_id: string }).patient_id)
    setLoading(false)
  }

  async function addToQueue(patientId: string) {
    setLoading(true)

    // Atomic token generation
    const { data: counter, error: counterError } = await supabase
      .rpc('increment_session_token', { p_session_id: sessionId })

    if (counterError) { setError(counterError.message); setLoading(false); return }

    const { error: queueError } = await supabase.from('queue_entries').insert({
      clinic_id:         clinicId,
      session_id:        sessionId,
      patient_id:        patientId,
      token_number:      counter as number,
      token_prefix:      'A',
      status:            'CHECKED_IN',
      source:            'reception',
      identity_verified: true,
    })

    if (queueError) { setError(queueError.message); setLoading(false); return }

    setLoading(false)
    onAdded()
  }

  async function handleConsentAgree() {
    if (!selectedId) return
    setLoading(true)

    const { data: clinicData } = await supabase
      .from('clinics').select('config').eq('id', clinicId).single()
    const consentVersion = clinicData?.config?.consent_version ?? 'v1.0'

    const { error: consentError } = await supabase.from('patient_consents').insert({
      patient_id:      selectedId,
      clinic_id:       clinicId,
      consent_text:    consentText,
      consent_version: consentVersion,
    })

    if (consentError) {
      setError(`Failed to record consent: ${consentError.message}`)
      setLoading(false)
      return
    }

    await addToQueue(selectedId)
    setLoading(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
        <h2 className="font-['Figtree'] font-semibold text-[#164e63]">Add Patient</h2>
        <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded p-1 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {step === 'search' && (
          <form onSubmit={handleMobileSearch} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="mobileSearch" className="text-sm font-medium text-[#164e63]">Mobile number</label>
              <input id="mobileSearch" type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)}
                required placeholder="9876543210" className={inputCls} />
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={loading} className={btnCls}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
        )}

        {step === 'select' && familyMembers && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#164e63]">Multiple patients found. Select the patient in front of you:</p>
            {familyMembers.map((m) => (
              <button key={m.id} type="button" onClick={() => checkConsentAndQueue(m.id)}
                className="cursor-pointer rounded-xl border border-gray-200 px-4 py-3 text-left text-[#164e63] transition-colors hover:border-[#0891b2] hover:bg-[#ecfeff]">
                {m.name} {m.dob ? `— ${new Date().getFullYear() - new Date(m.dob).getFullYear()}y` : ''}
              </button>
            ))}
            <button type="button" onClick={() => setStep('new')}
              className="cursor-pointer rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-[#0e7490] transition-colors hover:bg-gray-50">
              + New family member
            </button>
          </div>
        )}

        {step === 'new' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[#0e7490]">No existing patient found for {mobile}.</p>
            <div className="flex flex-col gap-1">
              <label htmlFor="newName" className="text-sm font-medium text-[#164e63]">Patient name <span className="text-red-500">*</span></label>
              <input id="newName" type="text" value={name} onChange={(e) => setName(e.target.value)}
                required className={inputCls} />
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="button" onClick={createNewPatient} disabled={loading || !name} className={btnCls}>
              {loading ? 'Adding…' : 'Add to Queue'}
            </button>
          </div>
        )}

        {step === 'consent' && (
          <div className="flex flex-col gap-4">
            <h3 className="font-['Figtree'] font-semibold text-[#164e63]">Patient Consent Required</h3>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 p-3 text-xs text-[#164e63] leading-relaxed">
              {consentText}
            </div>
            <p className="text-sm text-[#0e7490]">
              The patient has read and agrees to the above consent statement.
            </p>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="button" onClick={handleConsentAgree} disabled={loading} className={btnCls}>
              {loading ? 'Processing…' : 'Patient Agrees — Add to Queue'}
            </button>
            <button type="button" onClick={() => setStep('search')}
              className="cursor-pointer text-sm text-[#0e7490] hover:underline">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const inputCls = 'rounded-lg border border-gray-200 px-3 py-2 text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]'
const btnCls   = 'cursor-pointer rounded-lg bg-[#059669] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60'
