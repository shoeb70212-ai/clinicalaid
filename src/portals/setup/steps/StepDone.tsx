import { CheckCircle } from 'lucide-react'

interface Props {
  onEnterApp: () => void
}

export function StepDone({ onEnterApp }: Props) {
  return (
    <div className="text-center">
      <CheckCircle className="mx-auto mb-4 h-16 w-16 text-[#059669]" aria-hidden="true" />
      <h1 className="mb-2 font-['Figtree'] text-2xl font-bold text-[#164e63]">You&apos;re all set!</h1>
      <p className="mb-6 text-[#0e7490]">
        ClinicFlow is ready. Add your first patient to get started.
      </p>

      <button type="button" onClick={onEnterApp}
        className="cursor-pointer rounded-lg bg-[#059669] px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-[#047857]">
        Enter the app →
      </button>
    </div>
  )
}
