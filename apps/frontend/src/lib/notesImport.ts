import { strFromU8, unzipSync } from 'fflate'
import type { NotePayload, TagPayload } from '@tasks/shared'
import { newNotePayload, normalizeNote } from './notesModel.js'
import type { TasksNotesBackup } from './notesExport.js'

export type ImportedNote = NotePayload & { sourceId: string }
export type ImportedTag = TagPayload & { sourceId: string; parentSourceId: string | null }
export type ImportResult = { notes: ImportedNote[]; tags: ImportedTag[]; skipped: number; source: 'standardnotes' | 'tasks' }

type SnReference = { uuid: string; content_type: string; reference_type?: string }
type SnItem = {
  uuid: string
  content_type: string
  created_at?: string
  updated_at?: string
  deleted?: boolean
  content: string | {
    title?: string
    text?: string
    references?: SnReference[]
    appData?: Record<string, Record<string, unknown>>
    trashed?: boolean
    pinned?: boolean
    archived?: boolean
    locked?: boolean
    protected?: boolean
    noteType?: string
    editorIdentifier?: string
  }
}

export class ImportError extends Error {}

/** Accepts a StandardNotes decrypted backup (.txt/.json or the export .zip), or this app's own backup. */
export async function parseBackupFile(file: File): Promise<ImportResult> {
  if (file.size > 256 * 1024 * 1024) throw new ImportError('This backup is too large to import in the browser (256 MB limit).')
  const bytes = new Uint8Array(await file.arrayBuffer())
  // ZIP local-file header "PK\x03\x04".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    let expanded = 0
    const entries = unzipSync(bytes, { filter: entry => {
      if (!/\.(txt|json)$/i.test(entry.name) || entry.name.startsWith('__MACOSX')) return false
      expanded += entry.originalSize
      if (expanded > 64 * 1024 * 1024) throw new ImportError('The backup contains too much expanded text (64 MB limit).')
      return true
    } })
    // Prefer this app's lossless JSON, then the StandardNotes backup file.
    const names = Object.keys(entries).sort((a, b) => rank(a) - rank(b))
    for (const name of names) {
      try {
        const data = JSON.parse(strFromU8(entries[name]))
        if (!isTasksBackup(data) && !Array.isArray(data?.items)) continue
        return parseBackupJson(data)
      } catch (err) {
        if (err instanceof ImportError) throw err
      }
    }
    throw new ImportError('No StandardNotes backup file was found in that zip.')
  }
  let data: unknown
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ImportError('That file is not a StandardNotes backup. Export a decrypted backup from StandardNotes and choose the .txt or .zip file.')
  }
  return parseBackupJson(data)
}

function rank(name: string) {
  if (/notes-backup\.json$/i.test(name)) return 0
  if (/backup and import file/i.test(name)) return 1
  return 2
}

export function parseBackupJson(data: unknown): ImportResult {
  if (isTasksBackup(data)) return parseTasksBackup(data)
  const items = (data as { items?: unknown })?.items
  if (!Array.isArray(items)) throw new ImportError('That file is not a StandardNotes backup.')
  const typed = items as SnItem[]
  if (typed.some(i => typeof i.content === 'string' && /^00\d:/.test(i.content))) {
    throw new ImportError('This StandardNotes backup is encrypted. In StandardNotes, choose Preferences → Backups → Download backup and pick the decrypted option, then import that file.')
  }
  return parseStandardNotes(typed)
}

function isTasksBackup(data: unknown): data is TasksNotesBackup {
  return !!data && (data as TasksNotesBackup).format === 'tasks-notes' && Array.isArray((data as TasksNotesBackup).lists)
}

function parseTasksBackup(data: TasksNotesBackup): ImportResult {
  const notes: ImportedNote[] = []
  const tags: ImportedTag[] = []
  for (const list of data.lists) {
    for (const tag of list.tags ?? []) tags.push({ title: tag.title, parent_id: null, sourceId: tag.id, parentSourceId: tag.parent_id })
    for (const note of list.notes ?? []) {
      const { id, ...payload } = note
      notes.push({ ...normalizeNote(payload), sourceId: id })
    }
  }
  return { notes, tags, skipped: 0, source: 'tasks' }
}

function snAppData(content: Exclude<SnItem['content'], string>) {
  return content.appData?.['org.standardnotes.sn'] ?? {}
}

function iso(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function parseStandardNotes(items: SnItem[]): ImportResult {
  const live = items.filter(i => !i.deleted && i.content && typeof i.content === 'object')
  const noteItems = live.filter(i => i.content_type === 'Note')
  const tagItems = live.filter(i => i.content_type === 'Tag')
  const noteTags = new Map<string, string[]>()
  const tags: ImportedTag[] = []

  for (const item of tagItems) {
    const content = item.content as Exclude<SnItem['content'], string>
    const refs = content.references ?? []
    const parent = refs.find(r => r.content_type === 'Tag' && r.reference_type === 'TagToParentTag')
    tags.push({ title: (content.title || 'Untitled tag').replace(/\//g, '-'), parent_id: null, sourceId: item.uuid, parentSourceId: parent?.uuid ?? null })
    for (const ref of refs) {
      if (ref.content_type !== 'Note') continue
      noteTags.set(ref.uuid, [...(noteTags.get(ref.uuid) ?? []), item.uuid])
    }
  }

  const now = new Date().toISOString()
  const notes: ImportedNote[] = []
  let skipped = items.length - live.length
  for (const item of noteItems) {
    const content = item.content as Exclude<SnItem['content'], string>
    const app = snAppData(content)
    const created = iso(item.created_at, now)
    const edited = iso(app.client_updated_at ?? item.updated_at, created)
    let text = content.text ?? ''
    if (content.noteType === 'super' || content.editorIdentifier === 'com.standardnotes.super-editor' || looksLikeLexical(text)) {
      try { text = lexicalToMarkdown(JSON.parse(text)) } catch { skipped++; continue }
    }
    notes.push({
      ...newNotePayload(),
      title: content.title ?? '',
      text,
      editor: content.noteType === 'plain-text' ? 'plain' : 'markdown',
      tag_ids: noteTags.get(item.uuid) ?? [],
      pinned: !!(content.pinned ?? app.pinned),
      archived: !!(content.archived ?? app.archived),
      locked: !!(content.locked ?? app.locked),
      protected: !!content.protected,
      trashed_at: content.trashed ? edited : null,
      created_at: created,
      edited_at: edited,
      sourceId: item.uuid,
    })
  }
  return { notes, tags, skipped, source: 'standardnotes' }
}

function looksLikeLexical(text: string) {
  return text.startsWith('{"root":{') && text.includes('"type":"root"')
}

type LexicalNode = {
  type: string
  children?: LexicalNode[]
  text?: string
  format?: number | string
  tag?: string
  url?: string
  listType?: 'bullet' | 'number' | 'check'
  checked?: boolean
  language?: string
  [key: string]: unknown
}

const BOLD = 1, ITALIC = 2, STRIKE = 4, CODE = 16

function inline(nodes: LexicalNode[] = []): string {
  return nodes.map(node => {
    switch (node.type) {
      case 'text': {
        const format = typeof node.format === 'number' ? node.format : 0
        let t = node.text ?? ''
        if (!t) return ''
        if (format & CODE) return `\`${t}\``
        if (format & BOLD) t = `**${t}**`
        if (format & ITALIC) t = `_${t}_`
        if (format & STRIKE) t = `~~${t}~~`
        return t
      }
      case 'linebreak': return '  \n'
      case 'tab': return '\t'
      case 'link':
      case 'autolink': return `[${inline(node.children)}](${node.url ?? ''})`
      case 'hashtag':
      case 'code-highlight': return node.text ?? ''
      default: return node.children ? inline(node.children) : node.text ?? ''
    }
  }).join('')
}

function list(node: LexicalNode, depth: number): string[] {
  const lines: string[] = []
  let n = 1
  for (const item of node.children ?? []) {
    const nested = (item.children ?? []).filter(c => c.type === 'list')
    const own = (item.children ?? []).filter(c => c.type !== 'list')
    const indent = '  '.repeat(depth)
    if (own.length > 0 || nested.length === 0) {
      const marker = node.listType === 'number' ? `${n++}.` : node.listType === 'check' ? `- [${item.checked ? 'x' : ' '}]` : '-'
      lines.push(`${indent}${marker} ${inline(own)}`)
    }
    for (const sub of nested) lines.push(...list(sub, depth + 1))
  }
  return lines
}

/**
 * A Markdown table cell must stay on one line, and its pipes must not end the
 * cell. Escape backslashes too, or a cell ending in `\` would turn the
 * following escaped pipe back into a column separator.
 */
function tableCell(text: string) {
  return text.replace(/\s*\n\s*/g, ' ').replace(/[\\|]/g, '\\$&').trim()
}

function block(node: LexicalNode): string {
  switch (node.type) {
    case 'paragraph': return inline(node.children)
    case 'heading': return `${'#'.repeat(Number(node.tag?.slice(1)) || 1)} ${inline(node.children)}`
    case 'quote': return inline(node.children).split('\n').map(l => `> ${l}`).join('\n')
    case 'list': return list(node, 0).join('\n')
    case 'code': return `\`\`\`${node.language ?? ''}\n${inline(node.children).replace(/ {2}\n/g, '\n')}\n\`\`\``
    case 'horizontalrule': return '---'
    case 'table': {
      const rows = (node.children ?? []).map(row => (row.children ?? []).map(cell => (cell.children ?? []).map(block).join(' '))).map(row => row.map(tableCell))
      if (rows.length === 0) return ''
      const width = Math.max(...rows.map(r => r.length))
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
      return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')
    }
    // Embedded StandardNotes files are not in a decrypted backup.
    case 'snfile': return '_[attachment not imported]_'
    default: return node.children ? node.children.map(block).join('\n\n') : node.text ?? ''
  }
}

/** Basic StandardNotes "Super" (Lexical JSON) to Markdown. */
export function lexicalToMarkdown(state: { root?: LexicalNode }): string {
  if (!state?.root) throw new Error('Not a Lexical document')
  return (state.root.children ?? []).map(block).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Stable per-list id for an imported item, so importing the same backup into
 * the same list twice changes nothing, while another list gets fresh ids.
 */
export async function importId(listId: string, sourceId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tasks-import:${listId}:${sourceId}`)))
  const b = digest.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50 // version 5 (name-based)
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Map source ids to list-scoped ids and resolve tag parents and note tags. */
export async function assignIds(result: ImportResult, listId: string) {
  const ids = new Map<string, string>()
  for (const item of [...result.tags, ...result.notes]) ids.set(item.sourceId, await importId(listId, item.sourceId))
  const tags = result.tags.map(({ sourceId, parentSourceId, ...tag }) => ({
    id: ids.get(sourceId)!,
    payload: { ...tag, parent_id: parentSourceId ? ids.get(parentSourceId) ?? null : null } as TagPayload,
  }))
  const notes = result.notes.map(({ sourceId, ...note }) => ({
    id: ids.get(sourceId)!,
    payload: { ...note, tag_ids: note.tag_ids.map(id => ids.get(id)).filter((id): id is string => !!id), attachment_ids: [] } as NotePayload,
  }))
  return { tags, notes }
}

/** Group encrypted items so each request stays under both count and body-size limits. */
export function chunkBySize<T extends { encryptedPayload: string }>(items: T[], maxCount = 100, maxBytes = 3 * 1024 * 1024): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let size = 0
  for (const item of items) {
    if (current.length && (current.length >= maxCount || size + item.encryptedPayload.length > maxBytes)) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += item.encryptedPayload.length
  }
  if (current.length) chunks.push(current)
  return chunks
}
