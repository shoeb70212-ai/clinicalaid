import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Wifi, WifiOff } from 'lucide-react'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'

interface DisplaySync {
  session_id:       string
  current_token:    string | null   // TEXT in DB: trigger stores "A-1" format
  current_name:     string | null   // first-name only — no full PII
  next_token:       string | null   // TEXT in DB: trigger stores "A-1" format
  queue_count:      number
  session_status:   'open' | 'paused' | 'closed'
  clinic_name:      string
  updated_at:       string
}

/**
 * TV Display Portal — /display?session=<session_id>
 * Uses scoped JWT with role: display (set via URL param token).
 * Subscribes ONLY to queue_display_sync — never touches queue_entries.
 * Zero PII: shows token numbers + first name only.
 */
export function DisplayPortal() {
  const [params] = useSearchParams()
  const sessionId = params.get('session') ?? ''
  const online    = useConnectionStatus()

  const [display, setDisplay]   = useState<DisplaySync | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState<string | null>(null)
  const [flash,   setFlash]     = useState(false)   // brief highlight on token change

  // ── initial fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided. Add ?session=<id> to the URL.')
      setLoading(false)
      return
    }

    async function load() {
      const { data, error: err } = await supabase
        .from('queue_display_sync')
        .select('*')
        .eq('session_id', sessionId)
        .single()

      if (err) {
        setError('Session not found or access denied.')
      } else {
        setDisplay(data as DisplaySync)
      }
      setLoading(false)
    }

    load()
  }, [sessionId])

  // ── realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`display-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'queue_display_sync',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const next = payload.new as DisplaySync
          setDisplay((prev) => {
            // flash only if token actually changed
            if (prev?.current_token !== next.current_token) {
              setFlash(true)
              setTimeout(() => setFlash(false), 600)
            }
            return next
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId])

  // ── render ────────────────────────────────────────────────────────────────
  if (loading) return <DisplaySkeleton />

  if (error || !display) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#164e63]">
        <p className="text-xl text-white/70">{error ?? 'No display data.'}</p>
      </div>
    )
  }

  const paused = display.session_status === 'paused'
  const closed = display.session_status === 'closed'

  return (
    <div className="relative flex min-h-screen flex-col bg-[#164e63] text-white select-none">

      {/* ── header ── */}
      <header className="flex items-center justify-between px-10 py-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#a5f3fc]">
          {display.clinic_name}
        </h1>
        <div className="flex items-center gap-2 text-sm">
          {online
            ? <><Wifi    className="h-4 w-4 text-emerald-400" aria-hidden="true" /><span className="text-emerald-400">Live</span></>
            : <><WifiOff className="h-4 w-4 text-red-400"     aria-hidden="true" /><span className="text-red-400">Offline</span></>
          }
        </div>
      </header>

      {/* ── paused / closed overlay ── */}
      {(paused || closed) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70">
          <p className="text-5xl font-bold text-amber-400">
            {paused ? 'Queue Paused' : 'Session Closed'}
          </p>
          <p className="mt-4 text-xl text-white/60">
            {paused ? 'Please wait — the queue will resume shortly.' : 'Thank you for visiting.'}
          </p>
        </div>
      )}

      {/* ── main board ── */}
      <main className="flex flex-1 flex-col items-center justify-center gap-12 px-8">

        {/* current token */}
        <section className="flex flex-col items-center gap-4">
          <p className="text-xl font-medium uppercase tracking-widest text-[#7dd3fc]">
            Now Serving
          </p>
          <div
            className={`flex h-64 w-64 items-center justify-center rounded-3xl border-4 transition-all duration-300 ${
              flash
                ? 'border-[#06b6d4] bg-[#0891b2] scale-105'
                : 'border-[#0e7490] bg-[#0c4a6e]'
            }`}
          >
            {display.current_token != null ? (
              <span className="text-6xl font-extrabold tabular-nums sm:text-7xl md:text-8xl">
                {display.current_token}
              </span>
            ) : (
              <span className="text-4xl text-white/30">—</span>
            )}
          </div>
          {display.current_name && (
            <p className="text-2xl font-semibold text-[#bae6fd]" aria-live="polite">
              {display.current_name}
            </p>
          )}
        </section>

        {/* divider */}
        <div className="h-px w-72 bg-white/10" />

        {/* next token */}
        <section className="flex flex-col items-center gap-3">
          <p className="text-base font-medium uppercase tracking-widest text-[#7dd3fc]">
            Next
          </p>
          <div className="flex h-32 w-32 items-center justify-center rounded-2xl border-2 border-[#0e7490] bg-[#0c4a6e]">
            {display.next_token != null ? (
              <span className="text-5xl font-bold tabular-nums">
                {display.next_token}
              </span>
            ) : (
              <span className="text-2xl text-white/30">—</span>
            )}
          </div>
        </section>

      </main>

      {/* ── footer ── */}
      <footer className="flex items-center justify-between px-10 py-5 text-sm text-white/30">
        <span>{display.queue_count} patient{display.queue_count !== 1 ? 's' : ''} waiting</span>
        <span>ClinicFlow</span>
      </footer>
    </div>
  )
}

// ── loading skeleton ──────────────────────────────────────────────────────────
function DisplaySkeleton() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#164e63]">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-white/10" />
      <div className="h-64 w-64 animate-pulse rounded-3xl bg-white/10" />
      <div className="h-6 w-32 animate-pulse rounded-lg bg-white/10" />
    </div>
  )
}
