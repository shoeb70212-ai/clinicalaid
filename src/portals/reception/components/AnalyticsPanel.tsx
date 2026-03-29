import { useState, useEffect, useCallback } from 'react'
import { BarChart2, TrendingUp, RefreshCw } from 'lucide-react'
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '../../../lib/supabase'

interface DailyStat {
  day:            string
  total_patients: number
  completed:      number
  no_shows:       number
  revenue_paise:  number
}

interface TopItem {
  name:  string
  count: number
}

interface Props {
  clinicId:  string
  currency?: string
}

const PERIOD_OPTIONS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

function fmt(paise: number, currency = '₹') {
  return `${currency}${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export function AnalyticsPanel({ clinicId, currency = '₹' }: Props) {
  const [period,     setPeriod]     = useState(30)
  const [daily,      setDaily]      = useState<DailyStat[]>([])
  const [diagnoses,  setDiagnoses]  = useState<TopItem[]>([])
  const [drugs,      setDrugs]      = useState<TopItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    const [dailyRes, diagRes, drugRes] = await Promise.all([
      supabase.rpc('get_daily_stats',    { p_clinic_id: clinicId, p_days: period }),
      supabase.rpc('get_top_diagnoses',  { p_clinic_id: clinicId, p_days: period, p_limit: 8 }),
      supabase.rpc('get_top_drugs',      { p_clinic_id: clinicId, p_days: period, p_limit: 8 }),
    ])

    const errors = [dailyRes.error, diagRes.error, drugRes.error].filter(Boolean)
    if (errors.length > 0) {
      setFetchError(`Could not load some analytics data: ${errors.map(e => e!.message).join(', ')}`)
    }

    setDaily((dailyRes.data ?? []) as DailyStat[])
    setDiagnoses(((diagRes.data ?? []) as { complaint: string; count: number }[])
      .map((r) => ({ name: r.complaint, count: Number(r.count) })))
    setDrugs(((drugRes.data ?? []) as { drug_name: string; count: number }[])
      .map((r) => ({ name: r.drug_name, count: Number(r.count) })))
    setLoading(false)
  }, [clinicId, period])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Summary totals
  const totals = daily.reduce(
    (acc, d) => ({
      patients: acc.patients + d.total_patients,
      completed: acc.completed + d.completed,
      noShows: acc.noShows + d.no_shows,
      revenue: acc.revenue + d.revenue_paise,
    }),
    { patients: 0, completed: 0, noShows: 0, revenue: 0 },
  )

  const chartData = daily.map((d) => ({
    label: new Date(d.day + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    Patients: d.total_patients,
    Revenue:  Math.round(d.revenue_paise / 100),
  }))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'rgba(169,180,183,0.2)', backgroundColor: '#fff' }}>
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4" style={{ color: '#006a6a' }} />
          <span className="text-sm font-bold" style={{ color: '#2a3437', fontFamily: 'Manrope, sans-serif' }}>
            Analytics
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period switcher */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: '#d9e4e8' }}>
            {PERIOD_OPTIONS.map((o) => (
              <button key={o.days} type="button"
                onClick={() => setPeriod(o.days)}
                className="cursor-pointer px-2.5 py-1 text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: period === o.days ? '#006a6a' : '#fff',
                  color:           period === o.days ? '#fff'    : '#566164',
                }}>
                {o.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={fetchAll} disabled={loading}
            className="cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-gray-50 disabled:opacity-50"
            aria-label="Refresh analytics">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} style={{ color: '#566164' }} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-xs" style={{ color: '#a9b4b7' }}>Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Patients', value: totals.patients.toLocaleString('en-IN'), color: '#006a6a', bg: '#e0f4f4' },
                { label: 'Completed',      value: totals.completed.toLocaleString('en-IN'), color: '#166534', bg: '#dcfce7' },
                { label: 'No Shows',       value: totals.noShows.toLocaleString('en-IN'),   color: '#6b7280', bg: '#f3f4f6' },
                { label: 'Revenue',        value: fmt(totals.revenue, currency),             color: '#1d4ed8', bg: '#eff6ff' },
              ].map((card) => (
                <div key={card.label} className="rounded-xl p-3"
                  style={{ backgroundColor: card.bg }}>
                  <p className="text-xs font-semibold" style={{ color: card.color }}>
                    {card.label}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: card.color, fontFamily: 'Manrope, sans-serif' }}>
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Daily patients area chart */}
            {chartData.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
                  Daily Patients
                </p>
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="gradP" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#006a6a" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#006a6a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#a9b4b7' }} tickLine={false} axisLine={false}
                      interval={Math.floor(chartData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: '#a9b4b7' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                      itemStyle={{ color: '#006a6a' }} />
                    <Area type="monotone" dataKey="Patients" stroke="#006a6a" strokeWidth={2}
                      fill="url(#gradP)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Revenue bar chart */}
            {chartData.length > 0 && totals.revenue > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
                  Daily Revenue (₹)
                </p>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#a9b4b7' }} tickLine={false} axisLine={false}
                      interval={Math.floor(chartData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: '#a9b4b7' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                      formatter={(v) => [`${currency}${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                    <Bar dataKey="Revenue" fill="#0891b2" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top diagnoses */}
            {diagnoses.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
                  <TrendingUp className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  Top Complaints
                </p>
                <div className="flex flex-col gap-1.5">
                  {diagnoses.map((d) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="truncate text-xs capitalize font-medium" style={{ color: '#2a3437' }}>{d.name}</p>
                          <p className="ml-2 shrink-0 text-xs tabular-nums" style={{ color: '#566164' }}>{d.count}</p>
                        </div>
                        <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: '#e8eff1' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${Math.round((d.count / diagnoses[0].count) * 100)}%`,
                            backgroundColor: '#006a6a',
                          }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top drugs */}
            {drugs.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: '#566164' }}>
                  Top Prescribed Drugs
                </p>
                <div className="flex flex-col gap-1.5">
                  {drugs.map((d) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="truncate text-xs font-medium uppercase" style={{ color: '#2a3437' }}>{d.name}</p>
                          <p className="ml-2 shrink-0 text-xs tabular-nums" style={{ color: '#566164' }}>{d.count}</p>
                        </div>
                        <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: '#e8eff1' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${Math.round((d.count / drugs[0].count) * 100)}%`,
                            backgroundColor: '#0891b2',
                          }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {daily.length === 0 && diagnoses.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#e0f4f4' }}>
                  <BarChart2 className="h-5 w-5" style={{ color: '#006a6a' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: '#566164' }}>No data yet</p>
                <p className="mt-1 text-xs" style={{ color: '#a9b4b7' }}>Analytics will appear after completed consultations</p>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
