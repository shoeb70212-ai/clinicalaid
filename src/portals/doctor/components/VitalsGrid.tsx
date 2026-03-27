import type { ConsultationDraft } from '../../../types'

type Vitals = ConsultationDraft['vitals']

interface Props {
  vitals:   Vitals
  disabled: boolean
  onChange: (v: Vitals) => void
}

const FIELDS: { key: keyof Vitals; label: string; placeholder: string; unit?: string }[] = [
  { key: 'bp_systolic',  label: 'BP Systolic',  placeholder: '120', unit: 'mmHg' },
  { key: 'bp_diastolic', label: 'BP Diastolic', placeholder: '80',  unit: 'mmHg' },
  { key: 'temperature',  label: 'Temperature',  placeholder: '98.6', unit: '°F' },
  { key: 'spo2',         label: 'SpO2',         placeholder: '98',  unit: '%' },
  { key: 'pulse',        label: 'Pulse',        placeholder: '72',  unit: 'bpm' },
  { key: 'weight',       label: 'Weight',       placeholder: '70',  unit: 'kg' },
]

export function VitalsGrid({ vitals, disabled, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {FIELDS.map(({ key, label, placeholder, unit }) => (
        <div key={key} className="flex flex-col gap-0.5">
          <label className="text-xs font-medium text-[#0e7490]">{label}</label>
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            <input
              type="number"
              disabled={disabled}
              value={vitals[key]}
              onChange={(e) => onChange({ ...vitals, [key]: e.target.value })}
              placeholder={placeholder}
              min="0"
              className="flex-1 px-2 py-1.5 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] disabled:bg-gray-50 w-full"
            />
            {unit && <span className="shrink-0 px-2 text-xs text-gray-400">{unit}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
