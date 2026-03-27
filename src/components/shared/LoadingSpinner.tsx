interface Props {
  fullScreen?: boolean
  size?:       'sm' | 'md' | 'lg'
}

export function LoadingSpinner({ fullScreen = false, size = 'md' }: Props) {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }

  const spinner = (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full border-2 border-[#0891b2] border-t-transparent ${sizeClasses[size]}`}
    />
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#ecfeff]">
        {spinner}
      </div>
    )
  }

  return spinner
}
