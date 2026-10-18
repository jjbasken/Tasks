import { strToU8, zipSync, type Zippable } from 'fflate'
import type { NotePayload } from '@tasks/shared'
import { displayTitle, liveTagIds, tagPath, type DecryptedNote, type DecryptedTag } from './notesModel.js'
import type { Attachment } from './attachments.js'

function yamlString(value: string) {
  return JSON.stringify(value)
}

/** Markdown with YAML front matter, readable by most Markdown tools (Obsidian etc.). */
export function noteToMarkdown(note: NotePayload, tags: DecryptedTag[]): string {
  const tagList = liveTagIds(note, tags).map(id => tagPath(tags, id))
  const front = [
    '---',
    `title: ${yamlString(note.title)}`,
    `created: ${note.created_at}`,
    `updated: ${note.edited_at}`,
    tagList.length ? `tags: [${tagList.map(yamlString).join(', ')}]` : null,
    note.pinned ? 'pinned: true' : null,
    note.archived ? 'archived: true' : null,
    note.trashed_at ? `trashed: ${note.trashed_at}` : null,
    '---',
    '',
  ].filter(line => line !== null).join('\n')
  return front + note.text + (note.text.endsWith('\n') ? '' : '\n')
}

export function safeFilename(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)
  return cleaned || 'Untitled'
}

function uniqueName(used: Set<string>, base: string, ext: string) {
  let name = `${base}${ext}`
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`
  used.add(name.toLowerCase())
  return name
}

export type ExportList = { id: string; name: string }

/** Lossless JSON of everything decrypted; the importer here reads it back. */
export type TasksNotesBackup = {
  format: 'tasks-notes'
  version: 1
  exported_at: string
  lists: { id: string; name: string; tags: (DecryptedTag)[]; notes: (NotePayload & { id: string })[] }[]
}

/**
 * Zip with a folder per list holding one .md per note, attachments under
 * `attachments/`, and `notes-backup.json` for lossless re-import.
 */
export async function buildNotesArchive(opts: {
  lists: ExportList[]
  notes: DecryptedNote[]
  tags: DecryptedTag[]
  attachments: Attachment[]
  fetchAttachment: (attachment: Attachment) => Promise<Blob>
  onProgress?: (done: number, total: number) => void
}): Promise<Uint8Array> {
  const files: Zippable = {}
  const backup: TasksNotesBackup = { format: 'tasks-notes', version: 1, exported_at: new Date().toISOString(), lists: [] }
  const usedFolders = new Set<string>()
  const total = opts.notes.length + opts.attachments.length
  let done = 0
  for (const list of opts.lists) {
    const listNotes = opts.notes.filter(n => n.listId === list.id)
    const listTags = opts.tags.filter(t => t.listId === list.id)
    if (listNotes.length === 0 && listTags.length === 0) continue
    const folder = uniqueName(usedFolders, safeFilename(list.name), '')
    const usedNames = new Set<string>()
    for (const note of listNotes) {
      const sub = note.trashed_at ? 'Trash/' : note.archived ? 'Archive/' : ''
      files[`${folder}/${sub}${uniqueName(usedNames, safeFilename(displayTitle({ ...note, protected: false })), '.md')}`] = strToU8(noteToMarkdown(note, listTags))
      opts.onProgress?.(++done, total)
    }
    backup.lists.push({
      id: list.id, name: list.name, tags: listTags,
      notes: listNotes.map(({ listId: _l, updatedAt: _u, ...rest }) => rest),
    })
  }
  for (const attachment of opts.attachments) {
    const bytes = new Uint8Array(await (await opts.fetchAttachment(attachment)).arrayBuffer())
    files[`attachments/${attachment.id}-${safeFilename(attachment.name)}`] = [bytes, { level: 0 }]
    opts.onProgress?.(++done, total)
  }
  files['notes-backup.json'] = strToU8(JSON.stringify(backup, null, 2))
  return zipSync(files, { level: 6 })
}
