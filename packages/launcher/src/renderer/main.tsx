import './globals.css'
import './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initAnalytics } from './lib/analytics'

initAnalytics()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Renderer mount point #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
