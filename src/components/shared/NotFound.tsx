import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main id="main-content" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#ecfeff] p-8 text-center">
      <h1 className="font-['Figtree'] text-6xl font-bold text-[#0891b2]">404</h1>
      <p className="text-xl text-[#164e63]">Page not found</p>
      <Link
        to="/login"
        className="rounded-lg bg-[#0891b2] px-6 py-2 text-white transition-colors duration-200 hover:bg-[#0e7490] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0891b2]"
      >
        Go to login
      </Link>
    </main>
  )
}
