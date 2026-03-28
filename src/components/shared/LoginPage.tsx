import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Props {
  mode?: 'login' | 'invite'
}

// Google "G" logo SVG (official brand colours — no emoji)
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

export default function LoginPage({ mode = 'login' }: Props) {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [email,       setEmail]       = useState(mode === 'invite' ? params.get('email') ?? '' : '')
  const [password,    setPassword]    = useState('')
  const [name,        setName]        = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [showEmail,   setShowEmail]   = useState(mode === 'invite')
  const [loading,     setLoading]     = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const inviteToken = params.get('token')

  async function handleGoogleSignIn() {
    setOauthLoading(true)
    setError(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthError) {
      setError(oauthError.message)
      setOauthLoading(false)
    }
    // On success the browser redirects — no further handling needed here
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'invite' && inviteToken) {
      // Step 1: Create auth account
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      })
      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      // Step 2: Validate token and create staff record atomically
      const { error: consumeError } = await supabase.rpc('consume_invite', {
        p_token:   inviteToken,
        p_user_id: authData.user!.id,
        p_name:    name || email,
      })
      if (consumeError) {
        setError(consumeError.message)
        setLoading(false)
        return
      }

      // Refresh session so JWT now has clinic_id / staff_id claims
      await supabase.auth.refreshSession()
      navigate('/reception')
      return
    }

    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
    if (loginError) {
      setError(loginError.message)
      setLoading(false)
      return
    }

    // Check MFA
    const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (mfaData?.nextLevel === 'aal2' && mfaData?.currentLevel !== 'aal2') {
      navigate('/verify-mfa')
      return
    }

    // Query staff table directly for role (don't filter by is_active to see if user exists)
    const { data: staffRecord } = await supabase
      .from('staff')
      .select('role, is_active, totp_required')
      .eq('user_id', data.user.id)
      .single()

    if (!staffRecord) {
      navigate('/setup')
      return
    }

    if (!staffRecord.is_active) {
      setError('Your account has been deactivated. Contact your clinic admin.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    if (staffRecord.role === 'doctor' || staffRecord.role === 'admin') navigate('/doctor')
    else if (staffRecord.role === 'receptionist') navigate('/reception')
    else navigate('/setup')

    setLoading(false)
  }

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-[#ecfeff] p-4">
      <div className="w-full max-w-sm md:max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-6 font-['Figtree'] text-2xl font-bold text-[#164e63]">
          {mode === 'invite' ? 'Set up your account' : 'Sign in to ClinicFlow'}
        </h1>

        {/* Google OAuth — only on login mode, not invite */}
        {mode === 'login' && (
          <>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={oauthLoading}
              className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-medium text-[#164e63] transition-colors duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GoogleIcon />
              {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            {/* OAuth error — shown here so it's visible even when email form is collapsed */}
            {!showEmail && error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            {/* divider */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowEmail((v) => !v)}
                  className="flex cursor-pointer items-center gap-1 bg-white px-3 text-xs text-gray-400 hover:text-gray-600"
                  aria-expanded={showEmail}
                >
                  Use email instead
                  <ChevronDown
                    className={`h-3 w-3 transition-transform duration-200 ${showEmail ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Email/password form — always visible on invite, collapsible on login */}
        {showEmail && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            {mode === 'invite' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="name" className="text-sm font-medium text-[#164e63]">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]"
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-sm font-medium text-[#164e63]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                readOnly={mode === 'invite'}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[#164e63] read-only:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-sm font-medium text-[#164e63]">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={mode === 'invite' ? 'new-password' : 'current-password'}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[44px] w-[44px] cursor-pointer items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  {showPass
                    ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                    : <Eye    className="h-4 w-4" aria-hidden="true" />
                  }
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="cursor-pointer rounded-lg bg-[#059669] px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? 'Please wait…'
                : mode === 'invite' ? 'Create account' : 'Sign in'
              }
            </button>
          </form>
        )}

        {mode === 'login' && (
          <p className="mt-4 text-center text-sm text-[#0e7490]">
            First time?{' '}
            <a href="/setup" className="font-medium text-[#0891b2] hover:underline">
              Set up your clinic
            </a>
          </p>
        )}
      </div>
    </main>
  )
}
