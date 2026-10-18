import { decryptBytes, decryptSymmetric, encryptBytes, encryptSymmetric, fromBase64, generateFileKey, type FileMetadata } from '@tasks/shared'
import { session } from './session.js'

export type AttachmentRow = { id: string; size: number; encryptedMetadata: string; uploaded: boolean; createdAt: number; noteId?: string }
export type Attachment = FileMetadata & { id: string; uploaded: boolean; createdAt: number; noteId?: string }

export function encryptMetadata(meta: FileMetadata, listKey: string) {
  return JSON.stringify(encryptSymmetric(JSON.stringify(meta), fromBase64(listKey)))
}

export function decryptMetadata(row: AttachmentRow, listKey: string): Attachment | null {
  try {
    const meta: FileMetadata = JSON.parse(decryptSymmetric(JSON.parse(row.encryptedMetadata), fromBase64(listKey)))
    return { ...meta, id: row.id, uploaded: row.uploaded, createdAt: row.createdAt, noteId: row.noteId }
  } catch { return null }
}

function authHeaders(): Record<string, string> {
  const token = session.getToken()
  if (!token) throw new Error('Unlock your account again to use attachments.')
  return { authorization: `Bearer ${token}` }
}

type FilesApi = { create: { mutate: (input: { fileId: string; listId: string; noteId: string; size: number; encryptedMetadata: string }) => Promise<unknown> } }

/**
 * Each file gets its own random key, carried inside metadata encrypted with the
 * list key. Moving a note to another list then re-wraps a small key instead of
 * re-encrypting every attachment.
 */
export async function uploadAttachment(api: FilesApi, opts: { listId: string; noteId: string; file: File; listKey: string }) {
  const fileId = crypto.randomUUID()
  const fileKey = generateFileKey()
  const meta: FileMetadata = { name: opts.file.name || 'attachment', mime: opts.file.type || 'application/octet-stream', size: opts.file.size, file_key: fileKey }
  const sealed = encryptBytes(new Uint8Array(await opts.file.arrayBuffer()), fromBase64(fileKey))
  await api.create.mutate({ fileId, listId: opts.listId, noteId: opts.noteId, size: sealed.byteLength, encryptedMetadata: encryptMetadata(meta, opts.listKey) })
  const response = await fetch(`/api/files/${fileId}`, { method: 'PUT', headers: { ...authHeaders(), 'content-type': 'application/octet-stream' }, body: sealed as BlobPart })
  if (!response.ok) throw new Error(response.status === 413 ? 'That file is too large.' : 'The upload failed. Try again.')
  return { id: fileId, meta }
}

const blobUrls = new Map<string, string>()

export async function fetchAttachment(attachment: Pick<Attachment, 'id' | 'file_key' | 'mime'>): Promise<Blob> {
  const response = await fetch(`/api/files/${attachment.id}`, { headers: authHeaders() })
  if (!response.ok) throw new Error('Could not download the attachment.')
  const plain = decryptBytes(new Uint8Array(await response.arrayBuffer()), fromBase64(attachment.file_key))
  return new Blob([plain as BlobPart], { type: attachment.mime })
}

/** Decrypted object URL, reused for the life of the tab. */
export async function attachmentUrl(attachment: Pick<Attachment, 'id' | 'file_key' | 'mime'>) {
  const cached = blobUrls.get(attachment.id)
  if (cached) return cached
  const url = URL.createObjectURL(await fetchAttachment(attachment))
  blobUrls.set(attachment.id, url)
  return url
}

export function revokeAttachmentUrls() {
  blobUrls.forEach(url => URL.revokeObjectURL(url))
  blobUrls.clear()
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(mime)
