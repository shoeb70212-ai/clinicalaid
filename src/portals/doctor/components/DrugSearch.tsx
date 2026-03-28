import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import { Search, AlertTriangle, Plus, X } from 'lucide-react'
import { searchDrugs, checkBannedDrug, recordDrugUsage } from '../../../lib/drugSearch'
import { TIMING_LABEL } from '../../../lib/constants'
import type { DrugSearchResult, PrescriptionItem } from '../../../types'

interface Props {
  doctorId:   string
  clinicId:   string
  online:     boolean
  onAddDrug:  (item: PrescriptionItem) => void
}

/**
 * 3-tier drug search UI.
 * Tier 1: doctor_drug_preferences batch (fast, offline-capable)
 * Tier 2: master_drugs (fuzzy trgm, online only)
 * Tier 3: custom_clinic_drugs (sandbox, online only)
 *
 * Banned drug: hard red block — cannot add to Rx.
 * Schedule X: hard blocked by server (no bypass).
 * Doctor must tap result to pre-fill — nothing auto-adds.
 */
export function DrugSearch({ doctorId, clinicId, online, onAddDrug }: Props) {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<DrugSearchResult[]>([])
  const [loading,    setLoading]    = useState(false)
  const [selected,   setSelected]   = useState<DrugSearchResult | null>(null)
  const [banned,     setBanned]     = useState<{ date: string; reason: string } | null>(null)
  const [checking,   setChecking]   = useState(false)
  // prescription item form
  const [dosage,     setDosage]     = useState('')
  const [duration,   setDuration]   = useState('')
  const [timing,     setTiming]     = useState('')
  const [formError,  setFormError]  = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── debounced search ──────────────────────────────────────────────────────
  function handleQueryChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    setSelected(null)
    setBanned(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val.trim()) { setResults([]); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const found = await searchDrugs(val, doctorId, clinicId, online)
      setResults(found)
      setLoading(false)
    }, 300)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // ── select drug from results ──────────────────────────────────────────────
  async function handleSelect(drug: DrugSearchResult) {
    setResults([])
    setQuery(drug.drug_name)
    setChecking(true)
    setBanned(null)

    const check = await checkBannedDrug(drug.drug_name)
    setChecking(false)

    if (check.banned) {
      setBanned({ date: check.date ?? '', reason: check.reason ?? '' })
      setSelected(null)
      return
    }

    // pre-fill defaults from doctor batch
    setDosage(drug.default_dosage    ?? '')
    setDuration(String(drug.default_duration ?? ''))
    setTiming(drug.default_timing    ?? '')
    setSelected(drug)
  }

  // ── add to Rx ─────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!selected) return
    if (!dosage || !duration) {
      setFormError('Dosage and duration are required.')
      return
    }
    setFormError(null)

    const item: PrescriptionItem = {
      drug_name:    selected.drug_name,
      generic_name: selected.generic_name ?? '',
      dosage,
      duration_days: parseInt(duration) || 0,
      timing,
    }

    // record usage for learning engine (fire-and-forget)
    recordDrugUsage(clinicId, doctorId, item.drug_name, item.dosage, item.duration_days, item.timing ?? null).catch(() => null)

    onAddDrug(item)
    // reset form
    setQuery('')
    setSelected(null)
    setDosage('')
    setDuration('')
    setTiming('')
  }

  return (
    <div className="relative">

      {/* search input */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          type="search"
          role="combobox"
          aria-label="Search drugs"
          aria-expanded={results.length > 0}
          aria-autocomplete="list"
          value={query}
          onChange={handleQueryChange}
          placeholder={online ? 'Search drugs…' : 'Search batch (offline)'}
          disabled={checking}
          className="w-full rounded-xl py-2.5 pl-9 pr-4 text-sm disabled:opacity-50"
        style={{ backgroundColor: '#f0f4f6', color: '#2a3437', border: 'none', outline: 'none' }}
        />
        {loading && (
          <div
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-[#0891b2] border-t-transparent"
            aria-label="Searching"
          />
        )}
      </div>

      {/* ── BANNED DRUG HARD BLOCK ── */}
      {banned && (
        <div
          role="alert"
          className="mt-2 rounded-xl border-2 border-red-500 bg-red-50 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div>
              <p className="font-bold text-red-700">
                ALERT: This drug was banned by CDSCO{banned.date ? ` on ${banned.date}` : ''}.
              </p>
              {banned.reason && (
                <p className="mt-1 text-sm text-red-600">Reason: {banned.reason}</p>
              )}
              <p className="mt-2 text-sm font-medium text-red-700">
                This drug cannot be added to the prescription.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setBanned(null); setQuery('') }}
            className="mt-3 flex cursor-pointer items-center gap-1 text-sm text-red-600 hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Dismiss
          </button>
        </div>
      )}

      {/* results dropdown */}
      {results.length > 0 && !banned && (
        <ul
          role="listbox"
          aria-label="Drug results"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          {results.map((drug, i) => (
            <li key={i} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => handleSelect(drug)}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-[#e0f4f4]"
              >
                <div>
                  <span className="font-medium" style={{ color: '#2a3437' }}>
                    {drug.drug_name}
                  </span>
                  {drug.generic_name && (
                    <span className="ml-2 text-xs text-[#0e7490]">{drug.generic_name}</span>
                  )}
                </div>
                <span className={`text-xs ${
                  drug.source === 'batch'  ? 'text-[#0891b2]' :
                  drug.source === 'master' ? 'text-gray-400'  :
                  'text-amber-500'
                }`}>
                  {drug.source}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* offline fallback — shown only when no results and offline */}
      {query.trim().length > 0 && !banned && results.length === 0 && !online && (
        <p className="mt-1 text-xs text-gray-400 px-1">Not in your batch — add as custom drug when online.</p>
      )}

      {/* dosage form — shown after drug selected and not banned */}
      {selected && !banned && (
        <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: '#e0f4f4' }}>
          <p className="mb-3 font-semibold" style={{ fontFamily: 'Manrope, sans-serif', color: '#2a3437' }}>{selected.drug_name}</p>

          <div className="grid grid-cols-3 gap-2">
            {/* dosage */}
            <div>
              <label htmlFor="rxDosage" className="mb-1 block text-xs text-[#0e7490]">Dosage</label>
              <input
                id="rxDosage"
                type="text"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="1-0-1"
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#006a6a]"
              />
            </div>

            {/* duration */}
            <div>
              <label htmlFor="rxDuration" className="mb-1 block text-xs text-[#0e7490]">Days</label>
              <input
                id="rxDuration"
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="5"
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#006a6a]"
              />
            </div>

            {/* timing */}
            <div>
              <label htmlFor="rxTiming" className="mb-1 block text-xs text-[#0e7490]">Timing</label>
              <select
                id="rxTiming"
                value={timing}
                onChange={(e) => setTiming(e.target.value)}
                className="w-full cursor-pointer rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#006a6a]"
              >
                <option value="">—</option>
                {Object.entries(TIMING_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {formError && (
            <p role="alert" className="mt-2 text-xs text-red-600">{formError}</p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
              style={{ background: 'linear-gradient(135deg, #006a6a, #005c5c)' }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add to Rx
            </button>
            <button
              type="button"
              onClick={() => { setSelected(null); setQuery('') }}
              className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-[#164e63] transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
