import { useState, useEffect, useCallback } from 'react'
import { updateQueueStatus, updateQueueNotes, verifyIdentity } from '../../../lib/occ'
import { isValidTransition } from '../../../lib/transitions'
import { saveDraft, loadDraft, clearDraft } from '../../../lib/draftSave'
import { supabase } from '../../../lib/supabase'
import type { QueueEntryWithPatient, ConsultationDraft, PrescriptionItem, QueueStatus, RxTemplate } from '../../../types'
import { VitalsGrid } from './VitalsGrid'
import { VisitHistory } from './VisitHistory'
import { IdentityBanner } from './IdentityBanner'
import { PatientSidebar } from './PatientSidebar'
import { EncounterForm } from './EncounterForm'
import { ConsultationActions } from './ConsultationActions'

interface Props {
  entry:        QueueEntryWithPatient
  clinicId:     string
  doctorId:     string
  staffId:      string
  online:       boolean
  onUpdate:     () => void
  doctorName?:    string
  specialty?:     string | null
  regNumber?:     string | null
  clinicName?:    string
  clinicAddress?: string | null
  clinicPhone?:   string | null
}

export function ConsultationPanel({ entry, clinicId, doctorId, staffId, online, onUpdate, doctorName = '', specialty, regNumber, clinicName = '', clinicAddress, clinicPhone }: Props) {
  const patient = entry.patient

  const [tab,             setTab]             = useState<'notes' | 'history' | 'vitals'>('notes')
  const [draft,           setDraft]           = useState<ConsultationDraft>(() =>
    loadDraft(staffId, entry.id) ?? {
      queueEntryId:      entry.id,
      chiefComplaint:    '',
      quickNotes:        '',
      vitals:            { bp_systolic: '', bp_diastolic: '', temperature: '', spo2: '', pulse: '', weight: '' },
      prescriptionItems: [],
      savedAt:           Date.now(),
    }
  )
  const [draftRestored,   setDraftRestored]   = useState(() => !!loadDraft(staffId, entry.id))
  const [saveFailed,      setSaveFailed]      = useState(false)
  const [loading,         setLoading]         = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [templates,       setTemplates]       = useState<RxTemplate[]>([])

  // Load Rx templates for this doctor on mount
  useEffect(() => {
    supabase
      .from('rx_templates')
      .select('*')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setTemplates(data as RxTemplate[]) })
  }, [doctorId])

  useEffect(() => {
    const t = setTimeout(() => {
      const { saved } = saveDraft(staffId, entry.id, draft)
      setSaveFailed(!saved)
    }, 500)
    return () => clearTimeout(t)
  }, [draft, entry.id, staffId])

  const updateDraft = useCallback((patch: Partial<ConsultationDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    setDraftRestored(false)
  }, [])

  function handleAddDrug(item: PrescriptionItem) {
    setDraft((prev) => ({ ...prev, prescriptionItems: [...(prev.prescriptionItems ?? []), item] }))
    setDraftRestored(false)
  }

  function handleRemoveDrug(index: number) {
    updateDraft({ prescriptionItems: (draft.prescriptionItems ?? []).filter((_, i) => i !== index) })
  }

  async function handleSaveTemplate(name: string) {
    const items = draft.prescriptionItems ?? []
    if (!items.length) return
    const { data, error } = await supabase
      .from('rx_templates')
      .insert({ clinic_id: clinicId, doctor_id: doctorId, name: name.trim(), items })
      .select()
      .single()
    if (!error && data) setTemplates((prev) => [data as RxTemplate, ...prev])
  }

  function handleLoadTemplate(items: PrescriptionItem[]) {
    updateDraft({ prescriptionItems: items })
  }

  async function handleTransition(to: QueueStatus) {
    if (!online) return
    setLoading(true)
    setTransitionError(null)

    const result = await updateQueueStatus(entry.id, entry.version, to)

    if (to === 'COMPLETED' && result.success && result.data) {
      const { error: visitError } = await supabase.rpc('save_visit', {
        p_clinic_id:         clinicId,
        p_patient_id:        entry.patient_id,
        p_queue_entry_id:    entry.id,
        p_doctor_id:         doctorId,
        p_chief_complaint:   draft.chiefComplaint,
        p_examination_notes: draft.quickNotes,
        p_bp_systolic:       parseInt(draft.vitals.bp_systolic)   || null,
        p_bp_diastolic:      parseInt(draft.vitals.bp_diastolic)  || null,
        p_pulse:             parseInt(draft.vitals.pulse)         || null,
        p_temperature:       parseFloat(draft.vitals.temperature) || null,
        p_spo2:              parseInt(draft.vitals.spo2)          || null,
        p_weight:            parseFloat(draft.vitals.weight)      || null,
        p_prescriptions:     draft.prescriptionItems ?? [],
      })
      if (visitError) {
        setTransitionError('Visit notes could not be saved. Your draft is preserved.')
        setLoading(false)
        return
      }

      const notes = JSON.stringify({
        chiefComplaint:    draft.chiefComplaint,
        quickNotes:        draft.quickNotes,
        prescriptionItems: draft.prescriptionItems ?? [],
      })
      const notesResult = await updateQueueNotes(entry.id, result.data.version, notes)
      if (notesResult.success) clearDraft(staffId, entry.id)
    }

    setLoading(false)
    if (result.success || result.reason === 'conflict') {
      onUpdate()
    } else {
      setTransitionError(`Failed to update status: ${result.reason ?? 'Unknown error'}. Please try again.`)
    }
  }

  async function handleConfirmIdentity() {
    if (!online) return
    setLoading(true)
    const result = await verifyIdentity(entry.id, entry.version)
    setLoading(false)
    if (result.success || result.reason === 'conflict') onUpdate()
  }

  async function handleImposter() {
    if (!online) return
    setLoading(true)
    setTransitionError(null)
    const { error } = await supabase.rpc('unlink_and_isolate', { p_queue_entry_id: entry.id, p_clinic_id: clinicId })
    setLoading(false)
    if (error) {
      setTransitionError('Could not isolate patient: ' + error.message)
    } else {
      onUpdate()
    }
  }

  async function handleWriteReferral(toSpecialty: string, urgency: 'routine' | 'urgent' | 'emergency') {
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    try {
      const [{ pdf }, { ReferralPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./ReferralPDF'),
      ])
      const blob = await pdf(
        <ReferralPDF
          patientName={patient.name}
          patientDob={patient.dob ?? null}
          patientGender={patient.gender ?? null}
          doctorName={doctorName}
          specialty={specialty ?? null}
          regNumber={regNumber ?? null}
          clinicName={clinicName}
          clinicAddress={clinicAddress ?? null}
          clinicPhone={clinicPhone ?? null}
          referToSpecialty={toSpecialty}
          chiefComplaint={draft.chiefComplaint}
          clinicalNotes={draft.quickNotes}
          icd10Codes={draft.icd10Codes ?? []}
          urgency={urgency}
          date={date}
        />
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Referral_${patient.name.replace(/\s+/g, '_')}_${date}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setTransitionError('Could not generate referral: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  async function handleDownloadRx() {
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    try {
      const [{ pdf }, { PrescriptionPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./PrescriptionPDF'),
      ])
      const blob = await pdf(
        <PrescriptionPDF
          patientName={patient.name}
          patientDob={patient.dob ?? null}
          patientGender={patient.gender ?? null}
          doctorName={doctorName}
          specialty={specialty ?? null}
          regNumber={regNumber ?? null}
          clinicName={clinicName}
          clinicAddress={clinicAddress ?? null}
          clinicPhone={clinicPhone ?? null}
          chiefComplaint={draft.chiefComplaint}
          prescriptions={draft.prescriptionItems ?? []}
          date={date}
        />
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Rx_${patient.name.replace(/\s+/g, '_')}_${date}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setTransitionError('Could not generate PDF: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const canStart       = isValidTransition(entry.status, 'IN_CONSULTATION', 'doctor', entry.identity_verified)
  const inputsDisabled = !entry.identity_verified || entry.status === 'CALLED'
  const rxItems        = draft.prescriptionItems ?? []

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#f8fafb' }}>
      {/* Banners */}
      {draftRestored && (
        <div role="status" className="px-4 py-2 text-xs" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>
          Unsaved notes from previous session restored.
        </div>
      )}
      {saveFailed && (
        <div role="alert" className="px-4 py-2 text-xs" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
          Auto-save failed — browser storage is full.
        </div>
      )}

      {/* Identity verification banner */}
      {!entry.identity_verified && (
        <IdentityBanner
          entry={entry}
          loading={loading}
          online={online}
          onConfirm={handleConfirmIdentity}
          onImposter={handleImposter}
        />
      )}

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Col 1: Patient context + vitals */}
        <PatientSidebar
          entry={entry}
          draft={draft}
          inputsDisabled={inputsDisabled}
          onUpdateDraft={updateDraft}
        />

        {/* Col 2: Active encounter */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Mobile tabs */}
          <div className="flex md:hidden" style={{ borderBottom: '1px solid rgba(169,180,183,0.2)' }}>
            {(['notes', 'history', 'vitals'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className="flex-1 cursor-pointer py-2.5 text-xs font-semibold capitalize transition-colors"
                style={{
                  borderBottom: tab === t ? '2px solid #006a6a' : '2px solid transparent',
                  color: tab === t ? '#006a6a' : '#566164',
                }}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Notes tab (desktop always visible) */}
              <div className={tab !== 'notes' ? 'hidden md:flex flex-col flex-1 overflow-hidden' : 'flex flex-col flex-1 overflow-hidden'}>
                <EncounterForm
                  draft={draft}
                  entry={entry}
                  inputsDisabled={inputsDisabled}
                  clinicId={clinicId}
                  doctorId={doctorId}
                  staffId={staffId}
                  online={online}
                  templates={templates}
                  onUpdateDraft={updateDraft}
                  onAddDrug={handleAddDrug}
                  onRemoveDrug={handleRemoveDrug}
                  onSaveTemplate={handleSaveTemplate}
                  onLoadTemplate={handleLoadTemplate}
                />
              </div>

              {/* Vitals tab (mobile) */}
              {tab === 'vitals' && (
                <div className="flex-1 overflow-y-auto p-4 md:hidden">
                  <VitalsGrid vitals={draft.vitals} disabled={inputsDisabled}
                    onChange={(v) => updateDraft({ vitals: v })} />
                </div>
              )}

              {/* History tab (mobile) */}
              {tab === 'history' && (
                <div className="flex-1 overflow-y-auto p-4 md:hidden">
                  <VisitHistory patientId={patient.id} clinicId={clinicId} />
                </div>
              )}
            </div>

            {/* Col 3: Visit history (desktop) */}
            <div className="hidden w-60 shrink-0 overflow-y-auto p-4 md:block"
              style={{ borderLeft: '1px solid rgba(169,180,183,0.15)', backgroundColor: '#f8fafb' }}>
              <VisitHistory patientId={patient.id} clinicId={clinicId} />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky action footer */}
      <ConsultationActions
        entry={entry}
        canStart={canStart}
        hasRxItems={rxItems.length > 0}
        loading={loading}
        online={online}
        saveFailed={saveFailed}
        transitionError={transitionError}
        onTransition={handleTransition}
        onDownloadRx={handleDownloadRx}
        onDismissError={() => setTransitionError(null)}
        onWriteReferral={handleWriteReferral}
      />
    </div>
  )
}
