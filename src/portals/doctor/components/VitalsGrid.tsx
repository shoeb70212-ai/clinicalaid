import type { ConsultationDraft } from '../../../types'

type Vitals = ConsultationDraft['vitals']

interface Props {
  vitals:   Vitals
  disabled: boolean
  onChange: (v: Vitals) => void
}

interface VitalField {
  key:         keyof Vitals
  label:       string
  placeholder: string
  unit?:       string
  step?:       string
  warnLow?:    number
  warnHigh?:   number
  warnMsg?:    (val: number) => string
}

const FIELDS: VitalField[] = [
  {
    key: 'bp_systolic', label: 'BP Systolic', placeholder: '120', unit: 'mmHg',
    warnLow: 60, warnHigh: 180,
    warnMsg: (v) => v > 180 ? 'Hypertensive crisis' : 'Critically low',
  },
  {
    key: 'bp_diastolic', label: 'BP Diastolic', placeholder: '80', unit: 'mmHg',
    warnLow: 40, warnHigh: 120,
    warnMsg: (v) => v > 120 ? 'Critically high' : 'Critically low',
  },
  {
    key: 'temperature', label: 'Temperature', placeholder: '98.6', unit: '°F',
    step: '0.1', warnLow: 95, warnHigh: 103,
    warnMsg: (v) => v > 103 ? 'High fever' : 'Hypothermia',
  },
  {
    key: 'spo2', label: 'SpO2', placeholder: '98', unit: '%',
    warnLow: 92,
    warnMsg: () => 'Hypoxia — review urgently',
  },
  {
    key: 'pulse', label: 'Pulse', placeholder: '72', unit: 'bpm',
    warnLow: 40, warnHigh: 130,
    warnMsg: (v) => v > 130 ? 'Tachycardia' : 'Bradycardia',
  },
  { key: 'weight', label: 'Weight', placeholder: '70', unit: 'kg' },
  { key: 'height', label: 'Height', placeholder: '170', unit: 'cm' },
]

function bmiCategory(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: 'Underweight', color: '#2563eb' }
  if (bmi < 25)   return { label: 'Normal',       color: '#16a34a' }
  if (bmi < 30)   return { label: 'Overweight',   color: '#d97706' }
  return                 { label: 'Obese',         color: '#dc2626' }
}

export function VitalsGrid({ vitals, disabled, onChange }: Props) {
  const weightKg = parseFloat(vitals.weight)
  const heightCm = parseFloat(vitals.height)
  const bmi =
    !isNaN(weightKg) && !isNaN(heightCm) && heightCm > 0
      ? weightKg / Math.pow(heightCm / 100, 2)
      : null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(({ key, label, placeholder, unit, step, warnLow, warnHigh, warnMsg }) => {
          const raw = vitals[key]
          const num = raw !== '' && raw !== undefined ? Number(raw) : NaN
          const outOfRange =
            !isNaN(num) &&
            ((warnLow !== undefined && num < warnLow) ||
              (warnHigh !== undefined && num > warnHigh))
          const warning = outOfRange && warnMsg ? warnMsg(num) : null

          return (
            <div key={key} className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-[#0e7490]">{label}</label>
              <div
                className={`flex items-center rounded-lg border overflow-hidden ${
                  warning ? 'border-red-400 bg-red-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="number"
                  disabled={disabled}
                  value={raw}
                  onChange={(e) => onChange({ ...vitals, [key]: e.target.value })}
                  placeholder={placeholder}
                  min="0"
                  step={step ?? '1'}
                  className={`flex-1 px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2] disabled:bg-gray-50 w-full bg-transparent ${
                    warning ? 'text-red-700' : 'text-[#164e63]'
                  }`}
                />
                {unit && (
                  <span className={`shrink-0 px-2 text-xs ${warning ? 'text-red-400' : 'text-gray-400'}`}>
                    {unit}
                  </span>
                )}
              </div>
              {warning && (
                <span className="text-[10px] text-red-600 leading-tight">{warning}</span>
              )}
            </div>
          )
        })}
      </div>

      {/* BMI auto-calc */}
      {bmi !== null && (
        <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="text-xs text-gray-500">BMI</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[#164e63]">{bmi.toFixed(1)}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: `${bmiCategory(bmi).color}1a`, color: bmiCategory(bmi).color }}
            >
              {bmiCategory(bmi).label}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
