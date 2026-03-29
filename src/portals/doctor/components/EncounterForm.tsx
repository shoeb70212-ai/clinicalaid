import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, Trash2, X, Tag, Mic, MicOff } from 'lucide-react'
import { TIMING_LABEL } from '../../../lib/constants'
import { searchIcd10 } from '../../../lib/icd10'
import { createVoiceController, type VoiceController } from '../../../lib/voice'
import { DrugSearch } from './DrugSearch'
import { ScanAttachment } from './ScanAttachment'
import { checkInteractions, SEVERITY_COLOR, SEVERITY_LABEL } from '../../../lib/drugInteractions'
import type { QueueEntryWithPatient, ConsultationDraft, PrescriptionItem, RxTemplate } from '../../../types'

interface Props {
  draft:            ConsultationDraft
  entry:            QueueEntryWithPatient
  inputsDisabled:   boolean
  clinicId:         string
  doctorId:         string
  staffId:          string
  online:           boolean
  templates?:       RxTemplate[]
  onUpdateDraft:    (patch: Partial<ConsultationDraft>) => void
  onAddDrug:        (item: PrescriptionItem) => void
  onRemoveDrug:     (index: number) => void
  onSaveTemplate?:  (name: string) => void
  onLoadTemplate?:  (items: PrescriptionItem[]) => void
}

export function EncounterForm({
  draft, entry, inputsDisabled, clinicId, doctorId, staffId, online,
  templates = [], onUpdateDraft, onAddDrug, onRemoveDrug, onSaveTemplate, onLoadTemplate,
}: Props) {
  const [ccFocused,       setCcFocused]       = useState(false)
  const [notesFocused,    setNotesFocused]    = useState(false)
  const [showSaveInput,   setShowSaveInput]   = useState(false)
  const [templateName,    setTemplateName]    = useState('')
  const [templateSaved,   setTemplateSaved]   = useState(false)
  const [icdQuery,      setIcdQuery]      = useState('')
  const [icdDropOpen,   setIcdDropOpen]   = useState(false)
  const [voiceField,    setVoiceField]    = useState<'cc' | 'notes' | null>(null)
  const [voiceError,    setVoiceError]    = useState<string | null>(null)
  const icdRef                            = useRef<HTMLDivElement>(null)
  const ccVoiceRef                        = useRef<VoiceController | null>(null)
  const notesVoiceRef                     = useRef<VoiceController | null>(null)
  // Capture field text at the moment voice starts so session transcript can be appended
  const ccBaseTextRef                     = useRef('')
  const notesBaseTextRef                  = useRef('')

  // Stop voice when disabled or unmounted
  useEffect(() => {
    if (inputsDisabled) {
      ccVoiceRef.current?.stop()
      notesVoiceRef.current?.stop()
      setVoiceField(null)
    }
  }, [inputsDisabled])

  useEffect(() => () => {
    ccVoiceRef.current?.stop()
    notesVoiceRef.current?.stop()
  }, [])

  function toggleVoice(field: 'cc' | 'notes') {
    const ref     = field === 'cc' ? ccVoiceRef    : notesVoiceRef
    const otherRef= field === 'cc' ? notesVoiceRef : ccVoiceRef

    if (voiceField === field) {
      ref.current?.stop()
      setVoiceField(null)
      return
    }

    // Stop the other field if active
    otherRef.current?.stop()
    setVoiceError(null)

    // Capture current text so session transcript is appended, not replacing
    if (field === 'cc') ccBaseTextRef.current = draft.chiefComplaint ?? ''
    else notesBaseTextRef.current = draft.quickNotes ?? ''

    // Map patient's preferred language to a BCP-47 voice locale
    const VOICE_LOCALE: Record<string, string> = {
      en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN',
    }
    const voiceLang = VOICE_LOCALE[entry.patient?.preferred_language ?? ''] ?? 'en-IN'

    const ctrl = createVoiceController(
      (transcript) => {
        const base = field === 'cc' ? ccBaseTextRef.current : notesBaseTextRef.current
        const sep  = base.length > 0 && !base.endsWith(' ') ? ' ' : ''
        if (field === 'cc') onUpdateDraft({ chiefComplaint: base + sep + transcript })
        else                onUpdateDraft({ quickNotes:     base + sep + transcript })
      },
      (msg) => { setVoiceError(msg); setVoiceField(null) },
      voiceLang,
    )
    ref.current = ctrl

    if (!ctrl.supported) { setVoiceError('Speech recognition not supported in this browser.'); return }
    ctrl.start()
    setVoiceField(field)
  }

  const selectedCodes = draft.icd10Codes ?? []
  const icdResults    = searchIcd10(icdQuery)

  function addIcdCode(code: string) {
    if (!selectedCodes.includes(code)) {
      onUpdateDraft({ icd10Codes: [...selectedCodes, code] })
    }
    setIcdQuery('')
    setIcdDropOpen(false)
  }

  function removeIcdCode(code: string) {
    onUpdateDraft({ icd10Codes: selectedCodes.filter((c) => c !== code) })
  }

  const rxItems      = draft.prescriptionItems ?? []
  const drugNames    = useMemo(() => rxItems.map((i) => i.drug_name), [rxItems])
  const interactions = useMemo(() => checkInteractions(drugNames), [drugNames])

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">

      {/* Voice error banner */}
      {voiceError && (
        <div role="alert" className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
          style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
          <span>{voiceError}</span>
          <button type="button" onClick={() => setVoiceError(null)} className="ml-2 cursor-pointer font-semibold">✕</button>
        </div>
      )}

      {/* Chief Complaint */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="chiefComplaint" className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: '#006a6a' }}>1</span>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Chief Complaint</span>
          </label>
          {!inputsDisabled && (
            <button type="button" onClick={() => toggleVoice('cc')}
              aria-label={voiceField === 'cc' ? 'Stop dictation' : 'Start voice dictation for chief complaint'}
              className={`relative cursor-pointer rounded-lg p-1.5 transition-colors ${voiceField === 'cc' ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: voiceField === 'cc' ? '#fef2f2' : 'transparent', color: voiceField === 'cc' ? '#dc2626' : '#566164' }}>
              {voiceField === 'cc'
                ? <><MicOff className="h-3.5 w-3.5" aria-hidden="true" /><span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" /></>
                : <Mic className="h-3.5 w-3.5" aria-hidden="true" />
              }
            </button>
          )}
        </div>
        <textarea
          id="chiefComplaint"
          disabled={inputsDisabled}
          rows={3}
          value={draft.chiefComplaint}
          onChange={(e) => onUpdateDraft({ chiefComplaint: e.target.value })}
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

      {/* ICD-10 Diagnosis */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
        <label className="mb-2 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ backgroundColor: '#006a6a' }}>2</span>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Diagnosis (ICD-10)</span>
        </label>

        {/* Selected chips */}
        {selectedCodes.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selectedCodes.map((code) => (
              <span key={code}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold"
                style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}>
                <Tag className="h-3 w-3" aria-hidden="true" />
                {code}
                <button type="button" onClick={() => removeIcdCode(code)} disabled={inputsDisabled}
                  aria-label={`Remove ${code}`}
                  className="ml-0.5 cursor-pointer rounded hover:bg-[#95f2f1] disabled:opacity-40">
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        {!inputsDisabled && (
          <div ref={icdRef} className="relative">
            <input
              type="text"
              value={icdQuery}
              onChange={(e) => { setIcdQuery(e.target.value); setIcdDropOpen(true) }}
              onFocus={() => setIcdDropOpen(true)}
              onBlur={() => setTimeout(() => setIcdDropOpen(false), 150)}
              placeholder="Search ICD-10 code or condition…"
              className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none"
              style={{ backgroundColor: 'var(--color-surface-low)', border: '1.5px solid transparent', color: 'var(--color-ink)' }}
            />
            {icdDropOpen && icdResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
                {icdResults.map((e) => (
                  <button key={e.code} type="button"
                    onMouseDown={(ev) => { ev.preventDefault(); addIcdCode(e.code) }}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); addIcdCode(e.code) } }}
                    className="flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left text-xs hover:bg-[#e0f4f4]">
                    <span className="shrink-0 font-bold" style={{ color: '#006a6a' }}>{e.code}</span>
                    <span className="min-w-0 truncate" style={{ color: '#566164' }}>{e.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedCodes.length === 0 && inputsDisabled && (
          <p className="text-xs" style={{ color: '#a9b4b7' }}>No diagnosis codes added</p>
        )}
      </div>

      {/* Prescription Builder */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
        <div className="mb-3 flex items-center justify-between">
          <label className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: '#006a6a' }}>3</span>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Prescription Builder</span>
          </label>
          {rxItems.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}>
              {rxItems.length} med{rxItems.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Template toolbar */}
        {!inputsDisabled && (templates.length > 0 || rxItems.length > 0) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {templates.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const tpl = templates.find((t) => t.id === e.target.value)
                  if (tpl) onLoadTemplate?.(tpl.items)
                }}
                className="cursor-pointer rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                style={{ backgroundColor: 'var(--color-surface-low)', color: 'var(--color-ink)', border: '1.5px solid transparent' }}>
                <option value="">Load template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}

            {rxItems.length > 0 && !showSaveInput && (
              <button type="button"
                onClick={() => { setShowSaveInput(true); setTemplateName(''); setTemplateSaved(false) }}
                className="cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors"
                style={{ backgroundColor: '#e0f4f4', color: '#006a6a' }}>
                Save as template
              </button>
            )}

            {templateSaved && !showSaveInput && (
              <span className="text-xs font-semibold" style={{ color: '#006a6a' }}>✓ Template saved</span>
            )}

            {showSaveInput && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name…"
                  maxLength={80}
                  autoFocus
                  className="rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--color-surface-low)', border: '1.5px solid var(--color-primary)', color: 'var(--color-ink)', width: '140px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && templateName.trim()) {
                      onSaveTemplate?.(templateName.trim())
                      setShowSaveInput(false)
                      setTemplateSaved(true)
                    }
                    if (e.key === 'Escape') setShowSaveInput(false)
                  }}
                />
                <button type="button"
                  disabled={!templateName.trim()}
                  onClick={() => {
                    onSaveTemplate?.(templateName.trim())
                    setShowSaveInput(false)
                    setTemplateSaved(true)
                  }}
                  className="cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold disabled:opacity-40"
                  style={{ backgroundColor: '#006a6a', color: '#ffffff' }}>
                  Save
                </button>
                <button type="button" onClick={() => setShowSaveInput(false)}
                  className="cursor-pointer rounded-lg px-2 py-1.5 text-xs"
                  style={{ color: '#566164' }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Added medications list */}
        {rxItems.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {rxItems.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{ backgroundColor: '#f0f4f6' }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold font-heading" style={{ color: '#2a3437' }}>
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
                <button type="button" onClick={() => onRemoveDrug(idx)} disabled={inputsDisabled}
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
            onAddDrug={onAddDrug}
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

      {/* Drug interaction warnings */}
      {interactions.length > 0 && (
        <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: '#dc2626' }}>!</span>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
              Drug Interactions
            </span>
            <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
              {interactions.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {interactions.map((ix, idx) => (
              <div key={idx} className="rounded-lg p-3 text-xs"
                style={{
                  backgroundColor: SEVERITY_COLOR[ix.severity].bg,
                  border:          `1px solid ${SEVERITY_COLOR[ix.severity].border}`,
                  color:           SEVERITY_COLOR[ix.severity].text,
                }}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-bold">{ix.drugA} + {ix.drugB}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: SEVERITY_COLOR[ix.severity].border }}>
                    {SEVERITY_LABEL[ix.severity]}
                  </span>
                </div>
                <p style={{ opacity: 0.85 }}>{ix.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clinical Notes */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="quickNotes" className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: '#006a6a' }}>4</span>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Clinical Notes</span>
          </label>
          {!inputsDisabled && (
            <button type="button" onClick={() => toggleVoice('notes')}
              aria-label={voiceField === 'notes' ? 'Stop dictation' : 'Start voice dictation for clinical notes'}
              className={`relative cursor-pointer rounded-lg p-1.5 transition-colors ${voiceField === 'notes' ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: voiceField === 'notes' ? '#fef2f2' : 'transparent', color: voiceField === 'notes' ? '#dc2626' : '#566164' }}>
              {voiceField === 'notes'
                ? <><MicOff className="h-3.5 w-3.5" aria-hidden="true" /><span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" /></>
                : <Mic className="h-3.5 w-3.5" aria-hidden="true" />
              }
            </button>
          )}
        </div>
        <textarea
          id="quickNotes"
          disabled={inputsDisabled}
          rows={4}
          value={draft.quickNotes}
          onChange={(e) => onUpdateDraft({ quickNotes: e.target.value })}
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

      {/* Prescription scan */}
      <ScanAttachment
        clinicId={clinicId}
        queueEntryId={entry.id}
        patientId={entry.patient_id}
        uploadedBy={staffId}
        disabled={inputsDisabled}
        mode="prescription"
      />

      {/* Lab Reports */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', boxShadow: '0 2px 8px rgba(42,52,55,0.05)' }}>
        <label htmlFor="labFindings" className="mb-2 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ backgroundColor: '#006a6a' }}>5</span>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>Lab Reports</span>
        </label>
        <div className="mb-2">
          <ScanAttachment
            clinicId={clinicId}
            queueEntryId={entry.id}
            patientId={entry.patient_id}
            uploadedBy={staffId}
            disabled={inputsDisabled}
            mode="lab"
          />
        </div>
        {!inputsDisabled && (
          <textarea
            id="labFindings"
            rows={3}
            value={draft.labFindings ?? ''}
            onChange={(e) => onUpdateDraft({ labFindings: e.target.value })}
            placeholder="Key findings: Hb 11.2 g/dL · FBS 126 mg/dL · HbA1c 7.4%…"
            className="w-full resize-none rounded-lg p-3 text-sm transition-all"
            style={{
              backgroundColor: 'var(--color-surface-low)',
              border: '1.5px solid transparent',
              color: 'var(--color-ink)',
              outline: 'none',
            }}
          />
        )}
        {inputsDisabled && (draft.labFindings ?? '').length > 0 && (
          <p className="text-xs" style={{ color: '#566164' }}>{draft.labFindings}</p>
        )}
      </div>
    </div>
  )
}
