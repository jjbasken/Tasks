import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Vite otherwise inlines a modulepreload polyfill into index.html. Keeping the
    // built page free of inline scripts is what lets the CSP stay `script-src 'self'`.
    modulePreload: { polyfill: false },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
