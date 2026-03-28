import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ShieldCheck, ShieldX, Droplets, Trash2, Plus } from 'lucide-react'
import { updateQueueStatus, updateQueueNotes, verifyIdentity } from '../../../lib/occ'
import { isValidTransition } from '../../../lib/transitions'
import { saveDraft, loadDraft, clearDraft } from '../../../lib/draftSave'
import { calcAge } from '../../../lib/utils'
import { supabase } from '../../../lib/supabase'
import type { QueueEntryWithPatient, ConsultationDraft, PrescriptionItem } from '../../../types'
import { VitalsGrid } from './VitalsGrid'
import { VisitHistory } from './VisitHistory'
import { ScanAttachment } from './ScanAttachment'
import { DrugSearch } from './DrugSearch'

interface Props {
  entry:     QueueEntryWithPatient
  clinicId:  string
  doctorId:  string
  staffId:   string
  online:    boolean
  onUpdate:  () => void
}

const TIMING_LABEL: Record<string, string> = {
  after_food:     'After food',
  before_food:    'Before food',
  empty_stomach:  'Empty stomach',
  sos:            'SOS',
}

export function ConsultationPanel({ entry, clinicId, doctorId, staffId, online, onUpdate }: Props) {
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
      const notes = JSON.stringify({
        chiefComplaint:    draft.chiefComplaint,
        quickNotes:        draft.quickNotes,
        prescriptionItems: draft.prescriptionItems ?? [],
      })
      await updateQueueNotes(entry.id, result.data.version, notes)
      clearDraft(staffId, entry.id)
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

  const canStart     = isValidTransition(entry.status, 'IN_CONSULTATION', 'doctor', entry.identity_verified)
  const inputsDisabled = !entry.identity_verified || entry.status === 'CALLED'
  const age          = calcAge(patient.dob ?? null)
  const rxItems      = draft.prescriptionItems ?? []

  const bpValue = draft.vitals.bp_systolic && draft.vitals.bp_diastolic
    ? `${draft.vitals.bp_systolic}/${draft.vitals.bp_diastolic}`
    : null

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
        <div className="px-4 py-3" style={{ backgroundColor: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#92400e' }}>
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Unverified Check-In
              </div>
              <p className="mt-0.5 text-xs" style={{ color: '#b45309' }}>
                Age: {age ?? '—'} · Gender: {patient.gender ?? '—'} · Verify before starting consultation.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={handleConfirmIdentity} disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: '#006a6a' }}>
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirm
              </button>
              <button onClick={handleImposter} disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
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
              style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}>
              {entry.token_prefix}-{entry.token_number}
            </span>
            {entry.status === 'IN_CONSULTATION' && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: '#006a6a', color: '#fff' }}>Active</span>
            )}
          </div>

          {/* Patient name */}
          <div>
            <p className="text-base font-bold leading-tight" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>
              {patient.name}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: '#566164' }}>
              {age != null ? `${age} yrs` : ''}
              {age != null && patient.gender ? ' · ' : ''}
              {patient.gender === 'male' ? 'Male' : patient.gender === 'female' ? 'Female' : patient.gender ?? ''}
            </p>
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
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
              Current Vitals
            </p>
            <div className="flex flex-col gap-2">
              {/* BP */}
              <div className="rounded-xl p-3" style={{ backgroundColor: '#f0f4f6' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#566164' }}>Blood Pressure</p>
                {bpValue
                  ? <p className="mt-0.5 text-lg font-bold" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>{bpValue} <span className="text-xs font-normal" style={{ color: '#566164' }}>mmHg</span></p>
                  : <div className="mt-1 flex gap-1">
                      <input type="number" placeholder="120" min="0" value={draft.vitals.bp_systolic}
                        onChange={(e) => updateDraft({ vitals: { ...draft.vitals, bp_systolic: e.target.value } })}
                        disabled={inputsDisabled}
                        className="w-full rounded-lg px-2 py-1 text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#fff', border: 'none', color: '#2a3437' }} />
                      <span className="self-center text-xs" style={{ color: '#566164' }}>/</span>
                      <input type="number" placeholder="80" min="0" value={draft.vitals.bp_diastolic}
                        onChange={(e) => updateDraft({ vitals: { ...draft.vitals, bp_diastolic: e.target.value } })}
                        disabled={inputsDisabled}
                        className="w-full rounded-lg px-2 py-1 text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#fff', border: 'none', color: '#2a3437' }} />
                    </div>
                }
              </div>

              {/* HR + Temp row */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ backgroundColor: '#f0f4f6' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#566164' }}>HR</p>
                  {draft.vitals.pulse
                    ? <p className="mt-0.5 text-base font-bold" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>{draft.vitals.pulse} <span className="text-[10px] font-normal" style={{ color: '#566164' }}>bpm</span></p>
                    : <input type="number" placeholder="72" min="0" value={draft.vitals.pulse}
                        onChange={(e) => updateDraft({ vitals: { ...draft.vitals, pulse: e.target.value } })}
                        disabled={inputsDisabled}
                        className="mt-1 w-full rounded-lg px-2 py-1 text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#fff', border: 'none', color: '#2a3437' }} />
                  }
                </div>
                <div className="rounded-xl p-3" style={{ backgroundColor: '#f0f4f6' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#566164' }}>Temp</p>
                  {draft.vitals.temperature
                    ? <p className="mt-0.5 text-base font-bold" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>{draft.vitals.temperature}<span className="text-[10px] font-normal" style={{ color: '#566164' }}> °F</span></p>
                    : <input type="number" placeholder="98.6" min="0" value={draft.vitals.temperature}
                        onChange={(e) => updateDraft({ vitals: { ...draft.vitals, temperature: e.target.value } })}
                        disabled={inputsDisabled}
                        className="mt-1 w-full rounded-lg px-2 py-1 text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#fff', border: 'none', color: '#2a3437' }} />
                  }
                </div>
              </div>

              {/* SpO2 */}
              <div className="rounded-xl p-3" style={{ backgroundColor: '#f0f4f6' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#566164' }}>Oxygen Sat</p>
                {draft.vitals.spo2
                  ? <p className="mt-0.5 text-lg font-bold" style={{ fontFamily: 'Manrope, sans-serif', color: '#006a6a' }}>{draft.vitals.spo2}<span className="text-xs font-normal" style={{ color: '#566164' }}> %</span></p>
                  : <input type="number" placeholder="98" min="0" max="100" value={draft.vitals.spo2}
                      onChange={(e) => updateDraft({ vitals: { ...draft.vitals, spo2: e.target.value } })}
                      disabled={inputsDisabled}
                      className="mt-1 w-full rounded-lg px-2 py-1 text-sm disabled:opacity-50"
                      style={{ backgroundColor: '#fff', border: 'none', color: '#2a3437' }} />
                }
              </div>
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
                    className="w-full resize-none rounded-lg p-3 text-sm transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#f0f4f6', color: '#2a3437', outline: 'none', border: 'none', fontFamily: 'Inter, sans-serif' }}
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
                              <span className="rounded-md px-2 py-0.5 text-xs font-bold"
                                style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}>
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
                    className="w-full resize-none rounded-lg p-3 text-sm transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#f0f4f6', color: '#2a3437', outline: 'none', border: 'none', fontFamily: 'Inter, sans-serif' }}
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
            style={{ borderTop: '1px solid rgba(169,180,183,0.15)', backgroundColor: '#ffffff' }}>
            {canStart && (
              <button onClick={() => handleTransition('IN_CONSULTATION')}
                disabled={loading || !online}
                className="cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}>
                Start Consultation
              </button>
            )}
            {entry.status === 'IN_CONSULTATION' && (
              <>
                <button onClick={() => handleTransition('COMPLETED')}
                  disabled={loading || !online}
                  className="flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}>
                  End Consultation
                </button>
                <button onClick={() => handleTransition('SKIPPED')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
                  style={{ backgroundColor: '#f0f4f6', color: '#566164' }}>
                  Skip
                </button>
                <button onClick={() => handleTransition('NO_SHOW')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
                  style={{ backgroundColor: '#f0f4f6', color: '#566164' }}>
                  No Show
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
