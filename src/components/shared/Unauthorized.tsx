import { useNavigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export function Unauthorized() {
  const navigate  = useNavigate()
  const { staff, signOut } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ecfeff] px-4">
      <div className="flex max-w-sm flex-col items-center gap-6 text-center">

        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <ShieldOff className="h-8 w-8 text-red-500" aria-hidden="true" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#164e63]">Access Denied</h1>
          <p className="mt-2 text-sm text-[#0e7490]">
            {staff?.name
              ? `${staff.name}, your account `
              : 'Your account '}
            does not have permission to access this page.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#164e63] transition-colors hover:bg-gray-50"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={signOut}
            className="cursor-pointer rounded-lg bg-[#0891b2] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0e7490]"
          >
            Sign out
          </button>
        </div>

      </div>
    </div>
  )
}
