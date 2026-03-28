import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

interface Toast {
  id:       string
  type:     'success' | 'error' | 'info' | 'warning'
  message:  string
  duration: number
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS = {
  success: CheckCircle,
  error:   AlertCircle,
  info:    Info,
  warning: AlertTriangle,
}

const STYLES: Record<Toast['type'], { bg: string; border: string; color: string }> = {
  success: { bg: '#f0fdf4', border: '#86efac', color: '#166534' },
  error:   { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b' },
  info:    { bg: '#eff6ff', border: '#93c5fd', color: '#1d4ed8' },
  warning: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    const duration = t.duration ?? 4000
    setToasts((prev) => [...prev, { ...t, id, duration }])
    timers.current[id] = setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        className="fixed right-4 top-4 z-50 flex flex-col gap-2"
        style={{ maxWidth: '360px', width: 'calc(100vw - 2rem)' }}
      >
        {toasts.map((t) => {
          const Icon  = ICONS[t.type]
          const style = STYLES[t.type]
          return (
            <div
              key={t.id}
              role="alert"
              className="flex items-start gap-3 rounded-xl border p-3 shadow-lg"
              style={{ backgroundColor: style.bg, borderColor: style.border }}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: style.color }} aria-hidden="true" />
              <p className="flex-1 text-sm font-medium" style={{ color: style.color }}>{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 cursor-pointer rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" style={{ color: style.color }} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
