import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'offline-shell',
    apply: 'build',
    closeBundle() {
      const root = resolve(import.meta.dirname, 'dist')
      const files = (dir: string): string[] => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry => {
        const path = dir ? `${dir}/${entry.name}` : entry.name
        return entry.isDirectory() ? files(path) : [path]
      })
      const assets = files('').filter(path => path !== 'sw.js').sort()
      const hash = createHash('sha256')
      for (const path of assets) { hash.update(path); hash.update(readFileSync(resolve(root, path))) }
      const worker = readFileSync(resolve(root, 'sw.js'), 'utf8')
        .replace('__BUILD_ID__', hash.digest('hex').slice(0, 16))
        .replace(/\/\* __PRECACHE__ \*\/ \[[^\]]*\]/, JSON.stringify(assets.map(path => `/${path}`)))
      writeFileSync(resolve(root, 'sw.js'), worker)
    },
  }],
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
