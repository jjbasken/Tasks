import { afterEach, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeOfflineShell } from '../build/offlineShell.js'

const template = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const dirs: string[] = []
function dist(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-shell-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })

it('lists every built file and fingerprints their contents', () => {
  const files = { 'sw.js': template, 'index.html': '<html>', 'assets/index-abc.js': 'js', 'assets/nested/font.woff2': 'font', 'icon.svg': '<svg>' }
  const first = dist(files)
  writeOfflineShell(first)
  const worker = readFileSync(join(first, 'sw.js'), 'utf8')
  const precache = JSON.parse(worker.match(/const PRECACHE = (\[.*\])/)![1])
  expect(precache).toEqual(['/assets/index-abc.js', '/assets/nested/font.woff2', '/icon.svg', '/index.html'])
  expect(worker).not.toContain('__BUILD_ID__')
  expect(worker).not.toContain('__PRECACHE__')
  const id = (dir: string) => readFileSync(join(dir, 'sw.js'), 'utf8').match(/tasks-shell-([0-9a-f]{16})/)![1]
  const same = dist(files)
  writeOfflineShell(same)
  const changed = dist({ ...files, 'assets/index-abc.js': 'new js' })
  writeOfflineShell(changed)
  expect(id(same)).toBe(id(first))
  expect(id(changed)).not.toBe(id(first))
})

it('fails the build when the worker or its placeholders are missing', () => {
  expect(() => writeOfflineShell(dist({ 'index.html': '<html>' }))).toThrow('sw.js is missing')
  expect(() => writeOfflineShell(dist({ 'sw.js': template.replace('/* __PRECACHE__ */ ', '') }))).toThrow('placeholders')
})
