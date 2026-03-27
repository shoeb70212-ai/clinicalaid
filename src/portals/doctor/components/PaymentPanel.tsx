import { useState } from 'react'
import { DollarSign, CheckCircle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { QueueEntry } from '../../../types'

interface Props {
  entry:    QueueEntry
  clinicId: string
  staffId:  string
  onDone:   () => void
}

type PaymentMode = 'cash' | 'upi'

/**
 * Basic V1 payment recording panel.
 * Cash / UPI flag only — no Razorpay integration (V2).
 * Shown after doctor starts a consultation (status = IN_CONSULTATION).
 */
export function PaymentPanel({ entry, clinicId, staffId, onDone }: Props) {
  const [amount,  setAmount]  = useState('')
  const [method,  setMethod]  = useState<PaymentMode>('cash')
  const [waived,  setWaived]  = useState(false)
  const [loading, setLoading] = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSave() {
    setLoading(true)
    setError(null)

    if (!waived) {
      const parsed = parseFloat(amount)
      if (isNaN(parsed) || parsed < 0 || parsed > 100000) {
        setError('Enter a valid amount (₹0 – ₹1,00,000)')
        setLoading(false)
        return
      }
    }

    const amountPaise = waived ? 0 : Math.round(parseFloat(amount) * 100)

    const { error: err } = await supabase.from('payments').insert({
      clinic_id:      clinicId,
      queue_entry_id: entry.id,
      patient_id:     entry.patient_id,
      amount_paise:   amountPaise,
      method,
      status:         waived ? 'waived' : 'paid',
      collected_by:   staffId,
    })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    setSaved(true)
    setLoading(false)
    onDone()
  }

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Payment recorded.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#164e63]">
        <DollarSign className="h-4 w-4 text-[#0891b2]" aria-hidden="true" />
        Record Payment
      </h3>

      {/* waive toggle */}
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[#0e7490]">
        <input
          type="checkbox"
          checked={waived}
          onChange={(e) => setWaived(e.target.checked)}
          className="h-4 w-4 accent-[#0891b2]"
        />
        Waive fee
      </label>

      {!waived && (
        <div className="mb-3 flex flex-col gap-2">
          {/* amount */}
          <div>
            <label htmlFor="payAmount" className="mb-1 block text-xs text-[#0e7490]">
              Amount (₹)
            </label>
            <input
              id="payAmount"
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]"
            />
          </div>

          {/* method */}
          <div className="flex gap-2">
            {(['cash', 'upi'] as PaymentMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  method === m
                    ? 'border-[#0891b2] bg-[#cffafe] text-[#0e7490]'
                    : 'border-gray-200 bg-white text-[#164e63] hover:bg-gray-50'
                }`}
              >
                {m === 'cash' ? 'Cash' : 'UPI'}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={loading || (!waived && !amount)}
        className="w-full cursor-pointer rounded-lg bg-[#0891b2] py-2 text-sm font-medium text-white transition-colors hover:bg-[#0e7490] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Saving…' : waived ? 'Mark as Waived' : 'Mark as Paid'}
      </button>
    </div>
  )
}
