import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.js'
import { initCrypto } from '@tasks/shared'
import { watchForUpdates } from './lib/appUpdate.js'

// Crypto helpers are synchronous after libsodium is ready. Initialize before any
// query transform tries to unwrap session keys after a page reload.
void initCrypto().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode><App /></StrictMode>
  )
})

// Registered from the bundle rather than an inline <script> in index.html: with
// no inline script on the page the CSP can be a plain `script-src 'self'`, with
// no hash to keep in sync with the markup.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(watchForUpdates, () => {
      // Offline support is optional — a failed registration must not break boot.
    })
  })
}
