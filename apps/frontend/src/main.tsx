import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)

// Registered from the bundle rather than an inline <script> in index.html: with
// no inline script on the page the CSP can be a plain `script-src 'self'`, with
// no hash to keep in sync with the markup.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is optional — a failed registration must not break boot.
    })
  })
}
