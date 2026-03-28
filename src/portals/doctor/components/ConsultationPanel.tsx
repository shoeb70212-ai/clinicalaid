import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ShieldCheck, ShieldX, Droplets, Trash2, Plus, Download } from 'lucide-react'
import { updateQueueStatus, updateQueueNotes, verifyIdentity } from '../../../lib/occ'
import { isValidTransition } from '../../../lib/transitions'
import { saveDraft, loadDraft, clearDraft } from '../../../lib/draftSave'
import { calcAge } from '../../../lib/utils'
import { TIMING_LABEL } from '../../../lib/constants'
import { supabase } from '../../../lib/supabase'
import type { QueueEntryWithPatient, ConsultationDraft, PrescriptionItem } from '../../../types'
import { VitalsGrid } from './VitalsGrid'
import { VisitHistory } from './VisitHistory'
import { ScanAttachment } from './ScanAttachment'
import { DrugSearch } from './DrugSearch'

interface Props {
  entry:        QueueEntryWithPatient
  clinicId:     string
  doctorId:     string
  staffId:      string
  online:       boolean
  onUpdate:     () => void
  // For PDF generation
  doctorName?:    string
  specialty?:     string | null
  regNumber?:     string | null
  clinicName?:    string
  clinicAddress?: string | null
  clinicPhone?:   string | null
}

function PatientInitials({ name }: { name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  return (
    <div
      className="h-14 w-14 shrink-0 rounded-full flex items-center justify-center text-lg font-bold text-white"
      style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

interface VitalInputProps {
  label:       string
  value:       string
  placeholder: string
  unit?:       string
  min?:        string
  max?:        string
  step?:       string
  disabled:    boolean
  onChange:    (v: string) => void
}

function VitalInput({ label, value, placeholder, unit, min, max, step, disabled, onChange }: VitalInputProps) {
  const [focused, setFocused] = useState(false)
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface-low)' }}>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {label}{unit ? ` (${unit})` : ''}
      </p>
      <input
        type="number"
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        className="w-full rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
        style={{
          backgroundColor: focused ? 'var(--color-surface)' : 'var(--color-surface-container)',
          border: `1.5px solid ${focused ? 'var(--color-primary)' : 'transparent'}`,
          color: 'var(--color-ink)',
          outline: 'none',
        }}
      />
    </div>
  )
}

export function ConsultationPanel({ entry, clinicId, doctorId, staffId, online, onUpdate, doctorName = '', specialty, regNumber, clinicName = '', clinicAddress, clinicPhone }: Props) {
  const patient = entry.patient

  const [tab,         setTab]         = useState<'notes' | 'history' | 'vitals'>('notes')
  const [draft,       setDraft]       = useState<ConsultationDraft>(() => {
    return loadDraft(staffId, entry.id) ?? {
      queueEntryId:      entry.id,
      chiefComplaint:    '',
      quickNotes:        '',
      vitals:            { bp_systolic: '', bp_diastolic: '', temperature: '', spo2: '', pulse: '', weight: '' },
      prescriptionItems: [],
      savedAt:           Date.now(),
    }
  })
  const [draftRestored, setDraftRestored] = useState(() => !!loadDraft(staffId, entry.id))
  const [saveFailed,    setSaveFailed]    = useState(false)
  const [loading,       setLoading]       = useState(false)

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
    updateDraft({ prescriptionItems: [...(draft.prescriptionItems ?? []), item] })
  }

  function handleRemoveDrug(index: number) {
    updateDraft({
      prescriptionItems: (draft.prescriptionItems ?? []).filter((_, i) => i !== index),
    })
  }

  async function handleTransition(to: 'COMPLETED' | 'SKIPPED' | 'NO_SHOW' | 'CALLED' | 'IN_CONSULTATION') {
    if (!online) return
    setLoading(true)

    const result = await updateQueueStatus(entry.id, entry.version, to)

    if (to === 'COMPLETED' && result.success && result.data) {
      // Save structured visit record to the visits + prescriptions tables
      const { error: visitError } = await supabase.rpc('save_visit', {
        p_clinic_id:         clinicId,
        p_patient_id:        entry.patient_id,
        p_queue_entry_id:    entry.id,
        p_doctor_id:         doctorId,
        p_chief_complaint:   draft.chiefComplaint,
        p_examination_notes: draft.quickNotes,
        p_bp_systolic:       parseInt(draft.vitals.bp_systolic)  || null,
        p_bp_diastolic:      parseInt(draft.vitals.bp_diastolic) || null,
        p_pulse:             parseInt(draft.vitals.pulse)        || null,
        p_temperature:       parseFloat(draft.vitals.temperature) || null,
        p_spo2:              parseInt(draft.vitals.spo2)         || null,
        p_weight:            parseFloat(draft.vitals.weight)     || null,
        p_prescriptions:     draft.prescriptionItems ?? [],
      })
      if (visitError) console.error('[save_visit] Failed:', visitError.message)

      // Also write lightweight summary to queue_entries.notes for backward compat
      const notes = JSON.stringify({
        chiefComplaint:    draft.chiefComplaint,
        quickNotes:        draft.quickNotes,
        prescriptionItems: draft.prescriptionItems ?? [],
      })
      const notesResult = await updateQueueNotes(entry.id, result.data.version, notes)
      // Only clear draft if notes were persisted — on OCC conflict draft stays for recovery
      if (notesResult.success) {
        clearDraft(staffId, entry.id)
      }
    }

    setLoading(false)
    if (result.success || result.reason === 'conflict') onUpdate()
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
    await supabase.rpc('unlink_and_isolate', { p_queue_entry_id: entry.id, p_clinic_id: clinicId })
    setLoading(false)
    onUpdate()
  }

  async function handleDownloadRx() {
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const [{ pdf }, { PrescriptionPDF }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('./PrescriptionPDF'),
    ])
    const blob = await pdf(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PrescriptionPDF as any)({
        patientName:    patient.name,
        patientDob:     patient.dob ?? null,
        patientGender:  patient.gender ?? null,
        doctorName,
        specialty:      specialty ?? null,
        regNumber:      regNumber ?? null,
        clinicName,
        clinicAddress:  clinicAddress ?? null,
        clinicPhone:    clinicPhone ?? null,
        chiefComplaint: draft.chiefComplaint,
        prescriptions:  draft.prescriptionItems ?? [],
        date,
      })
    ).toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Rx_${patient.name.replace(/\s+/g, '_')}_${date}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canStart     = isValidTransition(entry.status, 'IN_CONSULTATION', 'doctor', entry.identity_verified)
  const inputsDisabled = !entry.identity_verified || entry.status === 'CALLED'
  const age          = calcAge(patient.dob ?? null)
  const rxItems      = draft.prescriptionItems ?? []

  const bpValue = draft.vitals.bp_systolic && draft.vitals.bp_diastolic
    ? `${draft.vitals.bp_systolic}/${draft.vitals.bp_diastolic}`
    : null

  const [ccFocused, setCcFocused]       = useState(false)
  const [notesFocused, setNotesFocused] = useState(false)

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
        <div className="px-4 py-3" style={{ backgroundColor: 'var(--color-warning-container)', borderBottom: '1px solid #fde68a' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl" style={{ backgroundColor: '#fef3c7' }}>
                <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-warning)' }} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Unverified Check-In</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--color-warning)' }}>
                  Age: {age ?? '—'} · Gender: {patient.gender ?? '—'} · Verify before starting consultation.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={handleConfirmIdentity} disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirm
              </button>
              <button onClick={handleImposter} disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-60"
                style={{ borderColor: '#fca5a5', color: '#991b1b', backgroundColor: '#fff' }}>
                <ShieldX className="h-3.5 w-3.5" aria-hidden="true" /> Mismatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Col 1: Patient context + vitals ── */}
        <div className="hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto p-4 md:flex"
          style={{ backgroundColor: '#ffffff', borderRight: '1px solid rgba(169,180,183,0.15)' }}>

          {/* Token + status */}
          <div className="flex items-center gap-2">
            <span className="rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums"
              style={{ backgroundColor: 'var(--color-primary-container)', color: 'var(--color-primary)' }}>
              {entry.token_prefix}-{entry.token_number}
            </span>
            {entry.status === 'IN_CONSULTATION' && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>Active</span>
            )}
          </div>

          {/* Patient avatar + name */}
          <div className="flex flex-col items-center text-center gap-2">
            <PatientInitials name={patient.name} />
            <div>
              <p className="text-base font-bold leading-tight font-heading" style={{ color: 'var(--color-ink)' }}>
                {patient.name}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                {age != null ? `${age} yrs` : ''}
                {age != null && patient.gender ? ' · ' : ''}
                {patient.gender === 'male' ? 'Male' : patient.gender === 'female' ? 'Female' : patient.gender ?? ''}
              </p>
              {patient.mobile && (
                <p className="mt-0.5 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{patient.mobile}</p>
              )}
            </div>
          </div>

          {/* Blood group */}
          {patient.blood_group && (
            <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: '#fef2f2' }}>
              <Droplets className="h-3.5 w-3.5 shrink-0" style={{ color: '#dc2626' }} aria-hidden="true" />
              <span className="text-xs font-bold" style={{ color: '#dc2626' }}>{patient.blood_group}</span>
            </div>
          )}

          {/* Vitals metric cards */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
              Current Vitals
            </p>
            <div className="flex flex-col gap-2">
              {/* BP — two inputs, handled separately */}
              <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface-low)' }}>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>BP (mmHg)</p>
                {bpValue
                  ? <p className="text-lg font-bold font-heading" style={{ color: 'var(--color-ink)' }}>
                      {bpValue} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>mmHg</span>
                    </p>
                  : <div className="flex gap-1">
                      <input type="number" placeholder="120" min="0" value={draft.vitals.bp_systolic}
                        onChange={(e) => updateDraft({ vitals: { ...draft.vitals, bp_systolic: e.target.value } })}
                        disabled={inputsDisabled}
                        className="w-full rounded-lg px-2 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-surface-container)', border: '1.5px solid transparent', color: 'var(--color-ink)', outline: 'none' }} />
                      <span className="self-center text-xs" style={{ color: 'var(--color-muted)' }}>/</span>
                      <input type="number" placeholder="80" min="0" value={draft.vitals.bp_diastolic}
                        onChange={(e) => updateDraft({ vitals: { ...draft.vitals, bp_diastolic: e.target.value } })}
                        disabled={inputsDisabled}
                        className="w-full rounded-lg px-2 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-surface-container)', border: '1.5px solid transparent', color: 'var(--color-ink)', outline: 'none' }} />
                    </div>
                }
              </div>

              <div className="grid grid-cols-2 gap-2">
                <VitalInput label="HR" unit="bpm" placeholder="72" min="0"
                  value={draft.vitals.pulse} disabled={inputsDisabled}
                  onChange={(v) => updateDraft({ vitals: { ...draft.vitals, pulse: v } })} />
                <VitalInput label="Temp" unit="°F" placeholder="98.6" min="0" step="0.1"
                  value={draft.vitals.temperature} disabled={inputsDisabled}
                  onChange={(v) => updateDraft({ vitals: { ...draft.vitals, temperature: v } })} />
              </div>

              <VitalInput label="SpO₂" unit="%" placeholder="98" min="0" max="100"
                value={draft.vitals.spo2} disabled={inputsDisabled}
                onChange={(v) => updateDraft({ vitals: { ...draft.vitals, spo2: v } })} />
            </div>
          </div>
        </div>

        {/* ── Col 2: Active encounter ── */}
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
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className={tab !== 'notes' ? 'hidden md:flex flex-col gap-3' : 'flex flex-col gap-3'}>

                {/* Chief Complaint */}
                <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
                  <label htmlFor="chiefComplaint" className="mb-2 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
                      style={{ backgroundColor: '#006a6a' }}>1</span>
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Chief Complaint</span>
                  </label>
                  <textarea
                    id="chiefComplaint"
                    disabled={inputsDisabled}
                    rows={3}
                    value={draft.chiefComplaint}
                    onChange={(e) => updateDraft({ chiefComplaint: e.target.value })}
                    onFocus={() => setCcFocused(true)}
                    onBlur={() => setCcFocused(false)}
                    className="w-full resize-none rounded-lg p-3 text-sm transition-all disabled:opacity-50"
                    style={{
                      backgroundColor: ccFocused ? 'var(--color-surface)' : 'var(--color-surface-low)',
                      border: `1.5px solid ${ccFocused ? 'var(--color-primary)' : 'transparent'}`,
                      color: 'var(--color-ink)',
                      outline: 'none',
                    }}
                    placeholder="Enter patient's chief complaint and primary concerns…"
                  />
                </div>

                {/* Prescription Builder */}
                <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
                  <div className="mb-3 flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
                        style={{ backgroundColor: '#006a6a' }}>2</span>
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Prescription Builder</span>
                    </label>
                    {rxItems.length > 0 && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}>
                        {rxItems.length} med{rxItems.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Added medications list */}
                  {rxItems.length > 0 && (
                    <div className="mb-3 flex flex-col gap-2">
                      {rxItems.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                          style={{ backgroundColor: '#f0f4f6' }}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
                              {item.drug_name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-md px-2 py-0.5 text-xs font-bold text-white"
                                style={{ backgroundColor: 'var(--color-primary)' }}>
                                {item.dosage}
                              </span>
                              <span className="text-xs" style={{ color: '#566164' }}>
                                {item.duration_days}d
                                {item.timing ? ` · ${TIMING_LABEL[item.timing] ?? item.timing}` : ''}
                              </span>
                            </div>
                          </div>
                          <button type="button" onClick={() => handleRemoveDrug(idx)} disabled={inputsDisabled}
                            className="ml-2 shrink-0 cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-red-50 disabled:opacity-40"
                            aria-label="Remove medication">
                            <Trash2 className="h-3.5 w-3.5" style={{ color: '#dc2626' }} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drug search */}
                  {!inputsDisabled && (
                    <DrugSearch
                      doctorId={doctorId}
                      clinicId={clinicId}
                      online={online}
                      onAddDrug={handleAddDrug}
                    />
                  )}

                  {inputsDisabled && rxItems.length === 0 && (
                    <div className="flex items-center gap-2 rounded-xl border-2 border-dashed p-4"
                      style={{ borderColor: '#d9e4e8' }}>
                      <Plus className="h-4 w-4" style={{ color: '#a9b4b7' }} aria-hidden="true" />
                      <span className="text-sm" style={{ color: '#a9b4b7' }}>Verify patient identity to add medications</span>
                    </div>
                  )}
                </div>

                {/* Clinical Notes */}
                <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
                  <label htmlFor="quickNotes" className="mb-2 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
                      style={{ backgroundColor: '#006a6a' }}>3</span>
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Clinical Notes</span>
                  </label>
                  <textarea
                    id="quickNotes"
                    disabled={inputsDisabled}
                    rows={4}
                    value={draft.quickNotes}
                    onChange={(e) => updateDraft({ quickNotes: e.target.value })}
                    onFocus={() => setNotesFocused(true)}
                    onBlur={() => setNotesFocused(false)}
                    className="w-full resize-none rounded-lg p-3 text-sm transition-all disabled:opacity-50"
                    style={{
                      backgroundColor: notesFocused ? 'var(--color-surface)' : 'var(--color-surface-low)',
                      border: `1.5px solid ${notesFocused ? 'var(--color-primary)' : 'transparent'}`,
                      color: 'var(--color-ink)',
                      outline: 'none',
                    }}
                    placeholder="Observations, findings, treatment plan…"
                  />
                </div>

                {/* Scan attachment */}
                <ScanAttachment
                  clinicId={clinicId}
                  queueEntryId={entry.id}
                  patientId={entry.patient_id}
                  uploadedBy={staffId}
                  disabled={inputsDisabled}
                />
              </div>

              {/* Vitals tab (mobile) */}
              {tab === 'vitals' && (
                <VitalsGrid vitals={draft.vitals} disabled={inputsDisabled}
                  onChange={(v) => updateDraft({ vitals: v })} />
              )}

              {/* History tab (mobile) */}
              {tab === 'history' && (
                <VisitHistory patientId={patient.id} clinicId={clinicId} />
              )}
            </div>

            {/* ── Col 3: Visit history (desktop) ── */}
            <div className="hidden w-60 shrink-0 overflow-y-auto p-4 md:block"
              style={{ borderLeft: '1px solid rgba(169,180,183,0.15)', backgroundColor: '#f8fafb' }}>
              <VisitHistory patientId={patient.id} clinicId={clinicId} />
            </div>
          </div>

          {/* Sticky action footer */}
          <div className="flex gap-2 p-3"
            style={{ borderTop: '1px solid rgba(169,180,183,0.15)', backgroundColor: 'var(--color-surface)' }}>
            {canStart && (
              <button onClick={() => handleTransition('IN_CONSULTATION')}
                disabled={loading || !online}
                className="cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}>
                Start Consultation
              </button>
            )}
            {entry.status === 'IN_CONSULTATION' && (
              <>
                <button onClick={() => handleTransition('COMPLETED')}
                  disabled={loading || !online}
                  className="flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}>
                  ✓ End Consultation
                </button>
                <button onClick={() => handleTransition('SKIPPED')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-surface-low)', color: 'var(--color-muted)' }}>
                  Skip
                </button>
                <button onClick={() => handleTransition('NO_SHOW')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-surface-low)', color: 'var(--color-muted)' }}>
                  No Show
                </button>
              </>
            )}
            {rxItems.length > 0 && (
              <button onClick={handleDownloadRx}
                className="ml-auto cursor-pointer rounded-xl border px-3 py-2.5 text-sm font-medium transition-all active:scale-95"
                style={{ borderColor: 'var(--color-surface-highest)', color: 'var(--color-primary)', backgroundColor: 'var(--color-surface)' }}
                aria-label="Download prescription PDF"
                title="Download Rx PDF">
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
