import { useState, useEffect } from 'react'
import { FileText, Printer, Download, X } from 'lucide-react'
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

interface QueueRow {
  token_number: number | null
  status:       string
  created_at:   string
  patient:      { name: string } | null
}

/**
 * End-of-day Z-Report modal.
 * Shown after session is closed from SessionControls.
 */
export function ZReport({ sessionId, onClose }: Props) {
  const [report,    setReport]    = useState<ZReportType | null>(null)
  const [queueRows, setQueueRows] = useState<QueueRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    async function fetchAll() {
      const [reportResult, queueResult] = await Promise.all([
        supabase.rpc('get_session_z_report', { p_session_id: sessionId }),
        supabase
          .from('queue_entries')
          .select('token_number, status, created_at, patient:patients(name)')
          .eq('session_id', sessionId)
          .order('token_number', { ascending: true }),
      ])

      if (reportResult.error) {
        setError(reportResult.error.message)
        setLoading(false)
        return
      }

      const raw = reportResult.data as RawReport
      setReport({
        session_id:     sessionId,
        total_patients: raw.total_patients ?? 0,
        completed:      raw.completed      ?? 0,
        no_shows:       raw.no_shows       ?? 0,
        cash_paise:     raw.cash_paise     ?? 0,
        upi_paise:      raw.upi_paise      ?? 0,
      })

      if (queueResult.error) {
        // Don't abort — still show summary totals, but note the CSV will be empty
        setError(`Summary loaded but queue details unavailable: ${queueResult.error.message}`)
      } else {
        setQueueRows((queueResult.data ?? []) as QueueRow[])
      }

      setLoading(false)
    }

    fetchAll()
  }, [sessionId])

  function formatRupees(paise: number) {
    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
  }

  function csvEscape(value: string): string {
    // RFC 4180: wrap in double-quotes and escape any internal double-quotes by doubling them
    if (value.includes('"') || value.includes(',') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  function downloadCSV() {
    const header = 'Token,Patient,Status,Time'
    const rows = queueRows.map((r) => {
      const token   = String(r.token_number ?? '')
      const patient = csvEscape(r.patient?.name ?? 'Unknown')
      const status  = r.status
      const time    = new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      return `${token},${patient},${status},${time}`
    })
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `session-${sessionId.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {/* Print: hide everything except the report card */}
      <style>{`@media print { body > * { display: none !important; } #zreport-print { display: block !important; position: static !important; } }`}</style>
    <div
      id="zreport-print"
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
              onClick={downloadCSV}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#164e63] transition-colors hover:bg-gray-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </button>
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
    </>
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
