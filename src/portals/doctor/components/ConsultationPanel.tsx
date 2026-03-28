import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ShieldCheck, ShieldX, Droplets } from 'lucide-react'
import { updateQueueStatus, updateQueueNotes, verifyIdentity } from '../../../lib/occ'
import { isValidTransition } from '../../../lib/transitions'
import { saveDraft, loadDraft, clearDraft } from '../../../lib/draftSave'
import { calcAge } from '../../../lib/utils'
import { supabase } from '../../../lib/supabase'
import type { QueueEntryWithPatient, ConsultationDraft } from '../../../types'
import { VitalsGrid } from './VitalsGrid'
import { VisitHistory } from './VisitHistory'
import { ScanAttachment } from './ScanAttachment'

interface Props {
  entry:     QueueEntryWithPatient
  clinicId:  string
  doctorId:  string
  staffId:   string
  online:    boolean
  onUpdate:  () => void
}

export function ConsultationPanel({ entry, clinicId, doctorId: _doctorId, staffId, online, onUpdate }: Props) {
  const patient = entry.patient

  const [tab,          setTab]          = useState<'notes' | 'history' | 'vitals'>('notes')
  const [draft,        setDraft]        = useState<ConsultationDraft>(() => {
    return loadDraft(staffId, entry.id) ?? {
      queueEntryId:   entry.id,
      chiefComplaint: '',
      quickNotes:     '',
      vitals: { bp_systolic: '', bp_diastolic: '', temperature: '', spo2: '', pulse: '', weight: '' },
      savedAt: Date.now(),
    }
  })
  const [draftRestored,  setDraftRestored]  = useState(() => !!loadDraft(staffId, entry.id))
  const [saveFailed,     setSaveFailed]     = useState(false)
  const [loading,        setLoading]        = useState(false)

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

  async function handleTransition(to: 'COMPLETED' | 'SKIPPED' | 'NO_SHOW' | 'CALLED' | 'IN_CONSULTATION') {
    if (!online) return
    setLoading(true)

    const result = await updateQueueStatus(entry.id, entry.version, to)

    if (to === 'COMPLETED' && result.success && result.data) {
      const notes = JSON.stringify({
        chiefComplaint: draft.chiefComplaint,
        quickNotes:     draft.quickNotes,
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

  const canStart = isValidTransition(entry.status, 'IN_CONSULTATION', 'doctor', entry.identity_verified)
  const inputsDisabled = !entry.identity_verified || entry.status === 'CALLED'
  const age = calcAge(patient.dob ?? null)

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#f8fafb' }}>
      {/* Draft restored banner */}
      {draftRestored && (
        <div role="status" className="px-4 py-2 text-xs" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>
          Unsaved notes from previous session restored.
        </div>
      )}

      {/* Auto-save failed banner */}
      {saveFailed && (
        <div role="alert" className="px-4 py-2 text-xs" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
          Auto-save failed — browser storage is full. Notes may not be saved.
        </div>
      )}

      {/* Identity verification banner (amber lock) */}
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
              <button
                onClick={handleConfirmIdentity}
                disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: '#006a6a' }}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirm Identity
              </button>
              <button
                onClick={handleImposter}
                disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
                style={{ borderColor: '#fca5a5', color: '#991b1b', backgroundColor: '#fff' }}
              >
                <ShieldX className="h-3.5 w-3.5" aria-hidden="true" /> Mismatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Col 1: Patient context card */}
        <div
          className="hidden w-52 shrink-0 flex-col gap-3 overflow-y-auto p-4 md:flex"
          style={{ backgroundColor: '#ffffff', borderRight: '1px solid rgba(169,180,183,0.15)' }}
        >
          {/* Token chip */}
          <div className="flex items-center gap-2">
            <span
              className="rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums"
              style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}
            >
              {entry.token_prefix}-{entry.token_number}
            </span>
            {entry.status === 'IN_CONSULTATION' && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: '#006a6a', color: '#fff' }}
              >
                Active
              </span>
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
            {patient.mobile && (
              <p className="mt-0.5 text-xs" style={{ color: '#566164' }}>{patient.mobile}</p>
            )}
          </div>

          {/* Blood group */}
          {patient.blood_group && (
            <div
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{ backgroundColor: '#fef2f2' }}
            >
              <Droplets className="h-3.5 w-3.5 shrink-0" style={{ color: '#dc2626' }} aria-hidden="true" />
              <span className="text-xs font-bold" style={{ color: '#dc2626' }}>{patient.blood_group}</span>
            </div>
          )}

        </div>

        {/* Col 2: Active encounter */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Mobile tabs */}
          <div className="flex md:hidden" style={{ borderBottom: '1px solid rgba(169,180,183,0.2)' }}>
            {(['notes', 'history', 'vitals'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="flex-1 cursor-pointer py-2.5 text-xs font-semibold capitalize transition-colors"
                style={{
                  borderBottom: tab === t ? '2px solid #006a6a' : '2px solid transparent',
                  color: tab === t ? '#006a6a' : '#566164',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Notes */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className={tab !== 'notes' ? 'hidden md:flex flex-col gap-3' : 'flex flex-col gap-3'}>

                {/* Chief Complaint */}
                <div
                  className="rounded-xl p-4"
                  style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}
                >
                  <label
                    htmlFor="chiefComplaint"
                    className="mb-2 block text-xs font-semibold uppercase tracking-widest"
                    style={{ color: '#566164' }}
                  >
                    Chief Complaint
                  </label>
                  <textarea
                    id="chiefComplaint"
                    disabled={inputsDisabled}
                    rows={3}
                    value={draft.chiefComplaint}
                    onChange={(e) => updateDraft({ chiefComplaint: e.target.value })}
                    className="w-full resize-none rounded-lg p-2.5 text-sm transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: '#f0f4f6',
                      color: '#2a3437',
                      outline: 'none',
                      border: 'none',
                      fontFamily: 'Inter, sans-serif',
                    }}
                    placeholder="Enter patient's chief complaint…"
                  />
                </div>

                {/* Clinical Notes */}
                <div
                  className="rounded-xl p-4"
                  style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}
                >
                  <label
                    htmlFor="quickNotes"
                    className="mb-2 block text-xs font-semibold uppercase tracking-widest"
                    style={{ color: '#566164' }}
                  >
                    Clinical Notes
                  </label>
                  <textarea
                    id="quickNotes"
                    disabled={inputsDisabled}
                    rows={5}
                    value={draft.quickNotes}
                    onChange={(e) => updateDraft({ quickNotes: e.target.value })}
                    className="w-full resize-none rounded-lg p-2.5 text-sm transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: '#f0f4f6',
                      color: '#2a3437',
                      outline: 'none',
                      border: 'none',
                      fontFamily: 'Inter, sans-serif',
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
                <VitalsGrid
                  vitals={draft.vitals}
                  disabled={inputsDisabled}
                  onChange={(v) => updateDraft({ vitals: v })}
                />
              )}

              {/* History tab (mobile) */}
              {tab === 'history' && (
                <VisitHistory patientId={patient.id} clinicId={clinicId} />
              )}
            </div>

            {/* Col 3: Visit history (desktop) */}
            <div
              className="hidden w-56 shrink-0 overflow-y-auto p-3 md:block"
              style={{ borderLeft: '1px solid rgba(169,180,183,0.15)', backgroundColor: '#f8fafb' }}
            >
              <VisitHistory patientId={patient.id} clinicId={clinicId} />
            </div>
          </div>

          {/* Sticky action footer */}
          <div
            className="flex gap-2 p-3"
            style={{ borderTop: '1px solid rgba(169,180,183,0.15)', backgroundColor: '#ffffff' }}
          >
            {canStart && (
              <button
                onClick={() => handleTransition('IN_CONSULTATION')}
                disabled={loading || !online}
                className="cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}
              >
                Start Consultation
              </button>
            )}
            {entry.status === 'IN_CONSULTATION' && (
              <>
                <button
                  onClick={() => handleTransition('COMPLETED')}
                  disabled={loading || !online}
                  className="flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}
                >
                  End Consultation
                </button>
                <button
                  onClick={() => handleTransition('SKIPPED')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
                  style={{ backgroundColor: '#f0f4f6', color: '#566164' }}
                >
                  Skip
                </button>
                <button
                  onClick={() => handleTransition('NO_SHOW')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
                  style={{ backgroundColor: '#f0f4f6', color: '#566164' }}
                >
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
