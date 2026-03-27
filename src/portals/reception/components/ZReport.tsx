import { useState, useEffect } from 'react'
import { FileText, Printer, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { ZReport as ZReportType } from '../../../types'

interface Props {
  sessionId: string
  onClose:   () => void
}

interface RawReport {
  total_patients: number
  completed:      number
  no_shows:       number
  cash_paise:     number | null
  upi_paise:      number | null
}

/**
 * End-of-day Z-Report modal.
 * Shown after session is closed from SessionControls.
 */
export function ZReport({ sessionId, onClose }: Props) {
  const [report,  setReport]  = useState<ZReportType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    async function fetchReport() {
      const { data, error: err } = await supabase.rpc('get_session_z_report', {
        p_session_id: sessionId,
      })

      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const raw = data as RawReport
      setReport({
        session_id:     sessionId,
        total_patients: raw.total_patients ?? 0,
        completed:      raw.completed      ?? 0,
        no_shows:       raw.no_shows       ?? 0,
        cash_paise:     raw.cash_paise     ?? 0,
        upi_paise:      raw.upi_paise      ?? 0,
      })
      setLoading(false)
    }

    fetchReport()
  }, [sessionId])

  function formatRupees(paise: number) {
    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="End-of-Day Report"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">

        {/* header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#0891b2]" aria-hidden="true" />
            <h2 className="font-semibold text-[#164e63]">End-of-Day Report</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* body */}
        <div className="p-6">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0891b2] border-t-transparent" />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">{error}</p>
          )}

          {report && (
            <dl className="flex flex-col gap-4">
              <ReportRow label="Total patients"  value={String(report.total_patients)} />
              <ReportRow label="Completed"        value={String(report.completed)}      />
              <ReportRow label="No-shows"         value={String(report.no_shows)}       />

              <div className="border-t border-gray-100 pt-4" />

              <ReportRow
                label="Cash collected"
                value={formatRupees(report.cash_paise ?? 0)}
                highlight
              />
              <ReportRow
                label="UPI collected"
                value={formatRupees(report.upi_paise ?? 0)}
                highlight
              />
              <ReportRow
                label="Total collected"
                value={formatRupees((report.cash_paise ?? 0) + (report.upi_paise ?? 0))}
                bold
              />
            </dl>
          )}
        </div>

        {/* footer */}
        {report && (
          <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#164e63] transition-colors hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg bg-[#0891b2] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0e7490]"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────
interface RowProps {
  label:     string
  value:     string
  highlight?: boolean
  bold?:     boolean
}

function ReportRow({ label, value, highlight, bold }: RowProps) {
  return (
    <div className="flex items-center justify-between">
      <dt className={`text-sm ${bold ? 'font-semibold text-[#164e63]' : 'text-[#0e7490]'}`}>
        {label}
      </dt>
      <dd className={`text-sm tabular-nums ${
        bold      ? 'font-bold text-[#164e63]' :
        highlight ? 'font-medium text-emerald-700' :
        'text-[#164e63]'
      }`}>
        {value}
      </dd>
    </div>
  )
}
