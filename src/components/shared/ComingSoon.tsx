import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'

interface Props {
  feature: string
}

/** V2 reserved routes render this instead of 404 */
export default function ComingSoon({ feature }: Props) {
  return (
    <main id="main-content" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#ecfeff] p-8 text-center">
      <Clock className="h-16 w-16 text-[#0891b2]" aria-hidden="true" />
      <h1 className="font-['Figtree'] text-3xl font-bold text-[#164e63]">{feature}</h1>
      <p className="max-w-sm text-[#0e7490]">
        This feature is coming in ClinicFlow V2. Stay tuned.
      </p>
      <Link
        to="/login"
        className="rounded-lg bg-[#0891b2] px-6 py-2 text-white transition-colors duration-200 hover:bg-[#0e7490]"
      >
        Back to app
      </Link>
    </main>
  )
}
