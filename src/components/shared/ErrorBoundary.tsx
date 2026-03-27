import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError:  boolean
  message:   string
}

/**
 * Top-level error boundary.
 * Catches any unhandled render/lifecycle throw and shows a recovery screen
 * instead of a blank white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error)
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Log to console for developer inspection; in V2 send to Sentry (scrub PII first)
    console.error('[ErrorBoundary] Caught:', error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main
        id="main-content"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#ecfeff] p-6 text-center"
      >
        <h1 className="font-['Figtree'] text-2xl font-bold text-[#164e63]">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-[#0e7490]">
          An unexpected error occurred. Please reload the page. If this keeps
          happening, contact your clinic administrator.
        </p>
        {import.meta.env.DEV && (
          <pre className="max-w-lg overflow-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-700">
            {this.state.message}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReload}
          className="cursor-pointer rounded-lg bg-[#0891b2] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0e7490]"
        >
          Reload page
        </button>
      </main>
    )
  }
}
