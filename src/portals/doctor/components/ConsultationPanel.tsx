import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ShieldCheck, ShieldX } from 'lucide-react'
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

  // Auto-save on every keystroke (debounced via useEffect)
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
      // Write notes via OCC using the updated version from the status transition.
      // If another write raced between status change and notes write, the conflict
      // is safe — draft is still recoverable from localStorage.
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
    <div className="flex h-full flex-col bg-white">
      {/* Draft restored banner */}
      {draftRestored && (
        <div role="status" className="bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Unsaved notes from previous session restored.
        </div>
      )}

      {/* Auto-save failed banner — browser storage full */}
      {saveFailed && (
        <div role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">
          Auto-save failed — browser storage is full. Notes may not be saved. Clear browser data or use a different device.
        </div>
      )}

      {/* Identity verification banner (amber lock) */}
      {!entry.identity_verified && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-semibold">Unverified Check-In</span>
              </div>
              <p className="mt-1 text-xs text-amber-600">
                Age: {age ?? '—'} · Gender: {patient.gender ?? '—'}
              </p>
              <p className="text-xs text-amber-600">Verify patient identity before starting consultation.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={handleConfirmIdentity} disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirm Identity
              </button>
              <button onClick={handleImposter} disabled={loading || !online}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60">
                <ShieldX className="h-3.5 w-3.5" aria-hidden="true" /> Mismatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Three-column layout (desktop) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Col 1: Context anchor */}
        <div className="hidden w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r border-gray-100 p-3 md:flex">
          <div>
            <p className="font-['Figtree'] text-base font-bold text-[#164e63]">{patient.name}</p>
            <p className="text-xs text-[#0e7490]">
              {age != null ? `${age}${patient.gender === 'male' ? 'M' : patient.gender === 'female' ? 'F' : ''}` : ''}
              {' · '}Token {entry.token_prefix}-{entry.token_number}
            </p>
            <p className="text-xs text-[#0e7490]">{patient.mobile}</p>
          </div>

          {/* Blood group */}
          {patient.blood_group && (
            <div className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
              {patient.blood_group}
            </div>
          )}
        </div>

        {/* Col 2: Active encounter */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs (mobile) */}
          <div className="flex border-b border-gray-100 md:hidden">
            {(['notes', 'history', 'vitals'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`flex-1 cursor-pointer py-2 text-xs font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-[#0891b2] text-[#0891b2]' : 'text-gray-400'}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Notes (always visible on desktop) */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className={tab !== 'notes' ? 'hidden md:flex flex-col gap-3' : 'flex flex-col gap-3'}>
                <div className="flex flex-col gap-1">
                  <label htmlFor="chiefComplaint" className="text-xs font-medium text-[#0e7490] uppercase tracking-wide">
                    Chief Complaint
                  </label>
                  <textarea
                    id="chiefComplaint"
                    disabled={inputsDisabled}
                    rows={3}
                    value={draft.chiefComplaint}
                    onChange={(e) => updateDraft({ chiefComplaint: e.target.value })}
                    className="resize-none rounded-lg border border-gray-200 p-2 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] disabled:bg-gray-50"
                    placeholder="Patient's chief complaint…"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="quickNotes" className="text-xs font-medium text-[#0e7490] uppercase tracking-wide">
                    Quick Notes
                  </label>
                  <textarea
                    id="quickNotes"
                    disabled={inputsDisabled}
                    rows={5}
                    value={draft.quickNotes}
                    onChange={(e) => updateDraft({ quickNotes: e.target.value })}
                    className="resize-none rounded-lg border border-gray-200 p-2 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] disabled:bg-gray-50"
                    placeholder="Notes, observations, treatment plan…"
                  />
                </div>

                {/* Paper prescription scan */}
                <ScanAttachment
                  clinicId={clinicId}
                  queueEntryId={entry.id}
                  patientId={entry.patient_id}
                  uploadedBy={staffId}
                  disabled={inputsDisabled}
                />
              </div>

              {/* Vitals tab (mobile) or inline (desktop) */}
              {(tab === 'vitals') && (
                <VitalsGrid vitals={draft.vitals} disabled={inputsDisabled}
                  onChange={(v) => updateDraft({ vitals: v })} />
              )}

              {/* History tab (mobile) */}
              {(tab === 'history') && (
                <VisitHistory patientId={patient.id} clinicId={clinicId} />
              )}
            </div>

            {/* Col 3: Visit history (desktop only) */}
            <div className="hidden w-52 shrink-0 overflow-y-auto border-l border-gray-100 p-3 md:block">
              <VisitHistory patientId={patient.id} clinicId={clinicId} />
            </div>
          </div>

          {/* Sticky action footer */}
          <div className="flex gap-2 border-t border-gray-100 p-3">
            {canStart && (
              <button onClick={() => handleTransition('IN_CONSULTATION')}
                disabled={loading || !online}
                className="cursor-pointer rounded-lg bg-[#0891b2] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0e7490] disabled:opacity-60">
                Start Consultation
              </button>
            )}
            {entry.status === 'IN_CONSULTATION' && (
              <>
                <button onClick={() => handleTransition('COMPLETED')}
                  disabled={loading || !online}
                  className="flex-1 cursor-pointer rounded-lg bg-[#059669] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#047857] disabled:opacity-60">
                  Mark Complete
                </button>
                <button onClick={() => handleTransition('SKIPPED')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#164e63] transition-colors hover:bg-gray-50 disabled:opacity-60">
                  Skip
                </button>
                <button onClick={() => handleTransition('NO_SHOW')}
                  disabled={loading || !online}
                  className="cursor-pointer rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#164e63] transition-colors hover:bg-gray-50 disabled:opacity-60">
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
