import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Fill the built service worker with a content fingerprint and the list of
 * every output file, so it installs the whole app shell or nothing.
 */
export function writeOfflineShell(outDir: string) {
  const workerPath = resolve(outDir, 'sw.js')
  if (!existsSync(workerPath)) throw new Error(`offline-shell: ${workerPath} is missing`)
  const files = (dir: string): string[] => readdirSync(resolve(outDir, dir), { withFileTypes: true }).flatMap(entry => {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    return entry.isDirectory() ? files(path) : [path]
  })
  const assets = files('').filter(path => path !== 'sw.js').sort()
  const hash = createHash('sha256')
  for (const path of assets) { hash.update(path); hash.update(readFileSync(resolve(outDir, path))) }
  const template = readFileSync(workerPath, 'utf8')
  const precache = /\/\* __PRECACHE__ \*\/ \[[^\]]*\]/
  // Fail the build rather than ship a worker that caches the wrong files.
  if (!template.includes('__BUILD_ID__') || !precache.test(template)) {
    throw new Error('offline-shell: sw.js no longer contains the __BUILD_ID__ and __PRECACHE__ placeholders')
  }
  const worker = template
    .replace('__BUILD_ID__', hash.digest('hex').slice(0, 16))
    .replace(precache, JSON.stringify(assets.map(path => `/${path}`)))
  writeFileSync(workerPath, worker)
  return assets
}

export function offlineShell(): Plugin {
  let outDir = ''
  return {
    name: 'offline-shell',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    // Runs only after a successful write, so a failed build reports its own error.
    writeBundle() { writeOfflineShell(outDir) },
  }
}
