'use client'

import * as Sentry from '@sentry/nextjs'
import { Component, ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

/**
 * Global Error Boundary — catches ANY uncaught error in the admin panel.
 *
 * Instead of a white screen, shows:
 *   - Error message (what went wrong)
 *   - "Refresh" button
 *   - "Go to Dashboard" button
 *
 * This is the LAST line of defense. Even if a page component crashes
 * with an unhandled error, this catches it and shows a friendly message.
 *
 * The admin panel must NEVER show a white screen or raw error stack trace.
 */
interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // 🐛 (audit 2026-07-28) This line previously carried the comment
    // "(in production, this goes to Sentry)" — and Sentry was not installed.
    // So every admin-panel crash went to a browser console nobody was
    // watching, and nothing ever reached the founder. The comment described
    // behaviour that did not exist, which is worse than no comment: it stopped
    // anyone looking for the gap.
    //
    // Sentry is now wired (sentry.client.config.ts) and captures this
    // automatically via the global handler. The explicit call below adds the
    // React component stack, which the automatic capture does not include.
    console.error('[GlobalErrorBoundary]', error, errorInfo)
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    })
  }

  handleRefresh = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  handleGoHome = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
          <div className="max-w-md w-full">
            <div className="bg-card rounded-xl border border-border p-6 text-center shadow-lg">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <h1 className="text-lg font-bold mb-2">Something went wrong</h1>
              <p className="text-sm text-muted-foreground mb-1">
                The admin panel encountered an unexpected error.
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                This has been logged. Try refreshing the page.
              </p>
              {this.state.error && (
                <details className="mb-4 text-left">
                  <summary className="text-xs text-muted-foreground cursor-pointer">
                    Show technical details
                  </summary>
                  <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto text-red-600">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
              <div className="flex gap-2 justify-center">
                <button
                  onClick={this.handleRefresh}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/50"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
