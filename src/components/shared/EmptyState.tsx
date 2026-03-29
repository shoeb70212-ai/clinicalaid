import type { ReactNode } from 'react'

interface Props {
  icon:      ReactNode
  title:     string
  subtitle?: string
  action?:   { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, subtitle, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ backgroundColor: 'var(--color-surface-container, #e8eff1)' }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--color-ink, #2a3437)' }}>
        {title}
      </p>
      {subtitle && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted, #566164)' }}>
          {subtitle}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--color-primary, #059669)' }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
