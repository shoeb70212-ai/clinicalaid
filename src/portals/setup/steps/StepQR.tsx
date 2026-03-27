import { useEffect, useState } from 'react'
import { QrCode, Printer } from 'lucide-react'
import type { SetupData } from '../SetupPortal'

interface Props {
  data:   Partial<SetupData>
  onNext: () => void
}

export function StepQR({ data, onNext }: Props) {
  const [qrUrl, setQrUrl] = useState('')

  useEffect(() => {
    if (data.clinicId) {
      // QR URL that patients will scan to self-check-in
      setQrUrl(`${window.location.origin}/qr/${data.clinicId}`)
    }
  }, [data.clinicId])

  function handlePrint() {
    window.print()
  }

  return (
    <div>
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">Your waiting room QR code</h1>
      <p className="mb-6 text-sm text-[#0e7490]">Step 4 of 5</p>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
        <div className="mx-auto mb-4 flex h-48 w-48 items-center justify-center rounded-xl bg-[#ecfeff]">
          <QrCode className="h-32 w-32 text-[#0891b2]" aria-hidden="true" />
          <span className="sr-only">QR code for patient self check-in</span>
        </div>
        <p className="mb-2 font-['Figtree'] font-semibold text-[#164e63]">Patient self check-in</p>
        <p className="mb-4 text-xs text-[#0e7490] break-all">{qrUrl}</p>
        <p className="mb-4 text-sm text-[#0e7490]">
          Print this and stick it in your waiting area.
          Patients scan to join your queue automatically.
        </p>
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#0891b2] px-4 py-2 text-sm text-[#0891b2] transition-colors duration-200 hover:bg-[#ecfeff]"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print QR code
        </button>
      </div>

      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onNext}
          className="flex-1 cursor-pointer rounded-lg bg-[#059669] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#047857]">
          Continue
        </button>
        <button type="button" onClick={onNext}
          className="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm text-[#0e7490] transition-colors duration-200 hover:bg-gray-50">
          Skip
        </button>
      </div>
    </div>
  )
}
