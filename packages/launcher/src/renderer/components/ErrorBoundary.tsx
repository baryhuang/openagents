import React from "react"

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Renderer error:", error, info?.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="p-8 min-h-screen overflow-auto font-sans text-(--text-primary) bg-(--bg-primary)">
        <h1 className="text-lg mb-3">
          The launcher hit a rendering error
        </h1>
        <pre className="p-3 rounded-lg text-xs max-h-120 overflow-auto whitespace-pre-wrap wrap-break-word bg-(--bg-card) border border-(--border)">
          {error.stack || error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          className="mt-3 px-3.5 py-1.5 rounded-md text-[13px] cursor-pointer border-0 bg-(--accent) text-(--accent-text)"
        >
          Try again
        </button>
      </div>
    )
  }
}
