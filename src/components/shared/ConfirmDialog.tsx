import { AlertTriangle, AlertCircle, Info } from 'lucide-react'

interface Props {
  open:          boolean
  title:         string
  description:   string
  confirmLabel?: string
  cancelLabel?:  string
  variant?:      'danger' | 'warning' | 'info'
  loading?:      boolean
  onConfirm:     () => void
  onCancel:      () => void
}

const VARIANT_STYLES = {
  danger:  { icon: AlertCircle,  iconColor: '#dc2626', btnBg: '#dc2626', btnHover: '#b91c1c' },
  warning: { icon: AlertTriangle, iconColor: '#b45309', btnBg: '#b45309', btnHover: '#92400e' },
  info:    { icon: Info,          iconColor: '#1d4ed8', btnBg: '#1d4ed8', btnHover: '#1e40af' },
}

export function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'danger', loading = false,
  onConfirm, onCancel,
}: Props) {
  if (!open) return null

  const { icon: Icon, iconColor, btnBg } = VARIANT_STYLES[variant]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${iconColor}15` }}>
            <Icon className="h-5 w-5" style={{ color: iconColor }} aria-hidden="true" />
          </div>
          <div>
            <p id="confirm-title" className="font-heading font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>
              {title}
            </p>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>{description}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="cursor-pointer rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
            style={{ borderColor: 'var(--color-outline)', color: 'var(--color-muted)', backgroundColor: '#fff' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
            style={{ backgroundColor: btnBg }}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
