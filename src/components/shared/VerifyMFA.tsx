import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Fingerprint } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

const WEBAUTHN_CRED_KEY = 'cf_webauthn_cred_id'

/**
 * TOTP verification step after password / OAuth login.
 * Doctor is authenticated (aal1) but needs aal2 to access /doctor portal.
 *
 * Biometric unlock (WebAuthn):
 *   - First time: after successful TOTP, registers a platform authenticator
 *     credential linked to this device. Stored as base64 in localStorage.
 *   - Subsequent visits: taps "Use Face ID / Fingerprint" →
 *     navigator.credentials.get() → assertion proves identity →
 *     TOTP challenge+verify is called automatically (using stored code from
 *     the credential's user handle flow is not possible without a custom server;
 *     instead we use WebAuthn as a UX unlock that auto-submits the last known
 *     challenge once the platform authenticator succeeds).
 *
 * Security note: WebAuthn here is an *unlock mechanism* — the actual MFA
 * verification still goes through Supabase TOTP verify. The biometric gesture
 * proves the doctor is physically present on the enrolled device. It does NOT
 * replace TOTP cryptographically. TOTP factor must remain enrolled in Supabase.
 *
 * Route: /verify-mfa
 */
export function VerifyMFA() {
  const navigate               = useNavigate()
  const { staff }              = useAuth()
  const [code,      setCode]      = useState('')
  const [loading,   setLoading]   = useState(false)
  const [biometric, setBiometric] = useState(false)
  const [canBio,    setCanBio]    = useState(false)
  const [bioEnroll, setBioEnroll] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Detect WebAuthn platform authenticator support on mount
  useEffect(() => {
    if (!window.PublicKeyCredential) return
    window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable()
      .then((available) => {
        if (available) {
          const enrolled = !!localStorage.getItem(WEBAUTHN_CRED_KEY)
          setCanBio(true)
          setBioEnroll(!enrolled) // needs enroll if no stored credential
        }
      })
      .catch(() => {/* not supported — canBio stays false */})
  }, [])

  async function getFactorId(): Promise<string> {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error || !data?.totp?.length) throw new Error('No MFA factor enrolled.')
    return data.totp[0].id
  }

  async function verifyTotp(totpCode: string): Promise<void> {
    const factorId = await getFactorId()
    const { data: challenge, error: challengeErr } =
      await supabase.auth.mfa.challenge({ factorId })
    if (challengeErr) throw challengeErr

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: totpCode,
    })
    if (verifyErr) throw new Error('Invalid code. Please try again.')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return

    setLoading(true)
    setError(null)

    try {
      await verifyTotp(code)

      // After first successful TOTP on a biometric-capable device → enroll
      if (canBio && bioEnroll) {
        await enrollBiometric()
      }

      navigate('/doctor', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
      setLoading(false)
    }
  }

  async function enrollBiometric() {
    // Register a resident-key credential bound to this device.
    // userId is derived from the Supabase user id (not PII in the credential).
    const session = (await supabase.auth.getSession()).data.session
    if (!session) return

    const userIdBytes = new TextEncoder().encode(session.user.id)

    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'ClinicFlow', id: window.location.hostname },
          user: {
            id: userIdBytes,
            name: staff?.email ?? session.user.email ?? 'doctor',
            displayName: staff?.name ?? 'Doctor',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7  },  // ES256
            { type: 'public-key', alg: -257 }, // RS256 fallback
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
        },
      }) as PublicKeyCredential | null

      if (credential) {
        // Store credential id so we can request an assertion later
        localStorage.setItem(WEBAUTHN_CRED_KEY, btoa(
          String.fromCharCode(...new Uint8Array(credential.rawId))
        ))
        setBioEnroll(false)
      }
    } catch {
      // Enrollment failed silently — doctor still gets in via TOTP
    }
  }

  async function handleBiometricUnlock() {
    const storedCredId = localStorage.getItem(WEBAUTHN_CRED_KEY)
    if (!storedCredId) return

    setBiometric(true)
    setError(null)

    try {
      // Decode the stored credential id
      const credIdBytes = Uint8Array.from(atob(storedCredId), (c) => c.charCodeAt(0))

      // Request assertion — triggers Face ID / Windows Hello / fingerprint
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: credIdBytes }],
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential | null

      if (!assertion) throw new Error('Biometric authentication cancelled.')

      // Biometric assertion proves physical presence on enrolled device.
      // We still need to satisfy Supabase aal2 — prompt for the TOTP code
      // silently by surfacing the code input with a note, OR if the doctor
      // has an authenticator app we ask them to enter the code just once.
      // For full passwordless flow we'd need a server-side WebAuthn verifier
      // (V2). In V1, biometrics unlocks the code input focus so the doctor
      // can quickly type their TOTP.
      setError(null)
      setBiometric(false)
      // Focus the code input
      document.getElementById('totpCode')?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Biometric failed. Use your authenticator code.')
      setBiometric(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#ecfeff] px-4">
      <div className="w-full max-w-sm">

        {/* card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">

          {/* icon */}
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#cffafe]">
              <ShieldCheck className="h-7 w-7 text-[#0891b2]" aria-hidden="true" />
            </div>
          </div>

          <h1 className="mb-1 text-center text-xl font-bold text-[#164e63]">
            Two-Factor Authentication
          </h1>
          <p className="mb-6 text-center text-sm text-[#0e7490]">
            {staff?.name
              ? `Welcome, ${staff.name}. `
              : ''}
            Enter the 6-digit code from your authenticator app.
          </p>

          {/* Biometric button — shown when enrolled and platform auth available */}
          {canBio && !bioEnroll && (
            <button
              type="button"
              onClick={handleBiometricUnlock}
              disabled={biometric}
              className="mb-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#0891b2] px-4 py-2.5 font-medium text-[#0891b2] transition-colors hover:bg-[#ecfeff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Fingerprint className="h-5 w-5" aria-hidden="true" />
              {biometric ? 'Waiting for biometric…' : 'Use Face ID / Fingerprint'}
            </button>
          )}

          {/* Biometric enroll notice — shown after first enroll prompt */}
          {canBio && bioEnroll && (
            <p className="mb-4 rounded-lg bg-[#ecfeff] px-3 py-2 text-center text-xs text-[#0e7490]">
              After signing in, you can use Face ID / Fingerprint next time.
            </p>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="totpCode" className="mb-1 block text-xs font-medium text-[#0e7490]">
                Authenticator code
              </label>
              <input
                id="totpCode"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                className="w-full rounded-lg border border-gray-200 px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-[#164e63] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0891b2]"
              />
            </div>

            {error && (
              <p role="alert" className="text-center text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="cursor-pointer rounded-lg bg-[#0891b2] px-4 py-3 font-medium text-white transition-colors hover:bg-[#0e7490] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            Lost your authenticator?{' '}
            <a href="mailto:support@clinicflow.in" className="text-[#0891b2] hover:underline">
              Contact support
            </a>
          </p>
        </div>

      </div>
    </div>
  )
}
