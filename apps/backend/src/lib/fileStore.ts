import { mkdirSync } from 'fs'
import { rm } from 'fs/promises'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Attachment ciphertext lives beside the database by default, so the existing
 * data volume holds everything a backup needs. Read per call so tests can point
 * it at a temporary directory.
 */
export function filesRoot() {
  if (process.env.FILES_PATH) return process.env.FILES_PATH
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl && dbUrl !== ':memory:') return join(dirname(dbUrl), 'files')
  return join(tmpdir(), 'tasks-files')
}

/** Only server-validated UUIDs ever become paths, so no id can escape the root. */
export function filePath(id: string) {
  if (!UUID.test(id)) throw new Error('Invalid file id')
  const root = filesRoot()
  mkdirSync(root, { recursive: true })
  return join(root, id.toLowerCase())
}

export async function removeStoredFiles(ids: string[]) {
  await Promise.all(ids.map(id => rm(filePath(id), { force: true }).catch(() => { /* already gone */ })))
}
