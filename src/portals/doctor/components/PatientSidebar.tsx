import { Droplets } from 'lucide-react'
import { calcAge } from '../../../lib/utils'
import type { QueueEntryWithPatient, ConsultationDraft } from '../../../types'

interface Props {
  entry:          QueueEntryWithPatient
  draft:          ConsultationDraft
  inputsDisabled: boolean
  onUpdateDraft:  (patch: Partial<ConsultationDraft>) => void
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

function VitalCard({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface-low)' }}>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {label}{unit ? ` (${unit})` : ''}
      </p>
      {children}
    </div>
  )
}

export function PatientSidebar({ entry, draft, inputsDisabled, onUpdateDraft }: Props) {
  const patient = entry.patient
  const age     = calcAge(patient.dob ?? null)

  const bpValue = draft.vitals.bp_systolic && draft.vitals.bp_diastolic
    ? `${draft.vitals.bp_systolic}/${draft.vitals.bp_diastolic}`
    : null

  const inputStyle = {
    backgroundColor: 'var(--color-surface-container)',
    border: '1.5px solid transparent',
    color: 'var(--color-ink)',
    outline: 'none',
  }

  return (
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
          {/* BP — two inputs */}
          <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface-low)' }}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>BP (mmHg)</p>
            {bpValue
              ? <p className="text-lg font-bold font-heading" style={{ color: 'var(--color-ink)' }}>
                  {bpValue} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>mmHg</span>
                </p>
              : <div className="flex gap-1">
                  <input type="number" placeholder="120" min="0" value={draft.vitals.bp_systolic}
                    onChange={(e) => onUpdateDraft({ vitals: { ...draft.vitals, bp_systolic: e.target.value } })}
                    disabled={inputsDisabled}
                    className="w-full rounded-lg px-2 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
                    style={inputStyle} />
                  <span className="self-center text-xs" style={{ color: 'var(--color-muted)' }}>/</span>
                  <input type="number" placeholder="80" min="0" value={draft.vitals.bp_diastolic}
                    onChange={(e) => onUpdateDraft({ vitals: { ...draft.vitals, bp_diastolic: e.target.value } })}
                    disabled={inputsDisabled}
                    className="w-full rounded-lg px-2 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
                    style={inputStyle} />
                </div>
            }
          </div>

          <div className="grid grid-cols-2 gap-2">
            <VitalCard label="HR" unit="bpm">
              <input type="number" placeholder="72" min="0"
                value={draft.vitals.pulse}
                onChange={(e) => onUpdateDraft({ vitals: { ...draft.vitals, pulse: e.target.value } })}
                disabled={inputsDisabled}
                className="w-full rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
                style={inputStyle} />
            </VitalCard>
            <VitalCard label="Temp" unit="°F">
              <input type="number" placeholder="98.6" min="0" step="0.1"
                value={draft.vitals.temperature}
                onChange={(e) => onUpdateDraft({ vitals: { ...draft.vitals, temperature: e.target.value } })}
                disabled={inputsDisabled}
                className="w-full rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
                style={inputStyle} />
            </VitalCard>
          </div>

          <VitalCard label="SpO₂" unit="%">
            <input type="number" placeholder="98" min="0" max="100"
              value={draft.vitals.spo2}
              onChange={(e) => onUpdateDraft({ vitals: { ...draft.vitals, spo2: e.target.value } })}
              disabled={inputsDisabled}
              className="w-full rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-all disabled:opacity-50"
              style={inputStyle} />
          </VitalCard>
        </div>
      </div>
    </div>
  )
}
