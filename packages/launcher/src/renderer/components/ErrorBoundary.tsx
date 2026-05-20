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
      <div
        style={{
          padding: 32,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          color: "var(--text-primary)",
          background: "var(--bg-primary)",
          minHeight: "100vh",
          overflow: "auto",
        }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>
          The launcher hit a rendering error
        </h1>
        <pre
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 480,
            overflow: "auto",
          }}
        >
          {error.stack || error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          style={{
            marginTop: 12,
            padding: "6px 14px",
            background: "var(--accent)",
            color: "var(--accent-text)",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}
