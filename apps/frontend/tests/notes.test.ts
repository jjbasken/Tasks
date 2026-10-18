import { JSDOM } from 'jsdom'
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'

// DOMPurify needs a real DOM implementation; jsdom is the one it is tested against.
;(globalThis as any).window = new JSDOM('').window

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => storage.delete(key),
} })

const { session } = await import('../src/lib/session.js')
const { offlineQueue, applyQueuedNoteChanges, applyQueuedChanges } = await import('../src/lib/offlineQueue.js')
const { sendQueuedNoteMutation } = await import('../src/lib/syncQueue.js')
const { renderMarkdown, toggleTask, applyFormat, attachmentMarkdown } = await import('../src/lib/markdown.js')
const model = await import('../src/lib/notesModel.js')
const { mergeSync } = await import('../src/hooks/useNotes.js')

beforeAll(() => { session.setUserId('alice') })
beforeEach(() => { storage.clear(); session.setUserId('alice') })

describe('note outbox', () => {
  it('folds autosaves into the latest pending write but never into the head entry', () => {
    offlineQueue.add({ type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'v1' })
    offlineQueue.add({ type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'v2' })
    offlineQueue.add({ type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'v3' })
    expect(offlineQueue.getAll().map(m => 'encryptedPayload' in m && m.encryptedPayload)).toEqual(['v1', 'v3'])
  })

  it('folds edits into a pending create and stops at a later delete', () => {
    offlineQueue.add({ type: 'tag.create', listId: 'l', tagId: 't', encryptedPayload: 'tag' })
    offlineQueue.add({ type: 'note.create', listId: 'l', noteId: 'n', encryptedPayload: 'v1' })
    offlineQueue.add({ type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'v2' })
    expect(offlineQueue.getAll().map(m => m.type)).toEqual(['tag.create', 'note.create'])
    expect((offlineQueue.getAll()[1] as { encryptedPayload: string }).encryptedPayload).toBe('v2')
    offlineQueue.add({ type: 'note.delete', listId: 'l', noteId: 'n' })
    offlineQueue.add({ type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'v3' })
    expect(offlineQueue.getAll().map(m => m.type)).toEqual(['tag.create', 'note.create', 'note.delete', 'note.update'])
  })

  it('overlays pending note and tag writes on server state', () => {
    offlineQueue.add({ type: 'note.create', listId: 'l', noteId: 'new', encryptedPayload: 'fresh' })
    offlineQueue.add({ type: 'note.update', listId: 'l', noteId: 'old', encryptedPayload: 'edited' })
    offlineQueue.add({ type: 'tag.delete', listId: 'l', tagId: 'gone' })
    offlineQueue.add({ type: 'note.update', listId: 'other', noteId: 'old', encryptedPayload: 'wrong list' })
    const row = (id: string, encryptedPayload: string) => ({ id, listId: 'l', encryptedPayload, createdAt: 1, updatedAt: 1 })
    const result = applyQueuedNoteChanges({ notes: [row('old', 'server')], tags: [row('gone', 't')] }, 'l', offlineQueue.getAll())
    expect(result.notes.map(n => [n.id, n.encryptedPayload])).toEqual([['old', 'edited'], ['new', 'fresh']])
    expect(result.tags).toEqual([])
  })

  it('keeps task overlays blind to note writes', () => {
    offlineQueue.add({ type: 'note.create', listId: 'l', noteId: 'n', encryptedPayload: 'x' })
    expect(applyQueuedChanges([], 'l', offlineQueue.getAll())).toEqual([])
  })

  it('treats a note deleted elsewhere as settled, but not an auth failure', async () => {
    const missing = { mutate: async () => { throw { data: { code: 'NOT_FOUND' } } } }
    const api = { notes: { create: missing, update: missing, delete: missing }, tags: { create: missing, update: missing, delete: missing } }
    await sendQueuedNoteMutation(api, { type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'x', id: '1', timestamp: 1 })
    await sendQueuedNoteMutation(api, { type: 'tag.delete', listId: 'l', tagId: 't', id: '2', timestamp: 1 })
    api.notes.update = { mutate: async () => { throw { data: { code: 'UNAUTHORIZED' } } } }
    await expect(sendQueuedNoteMutation(api, { type: 'note.update', listId: 'l', noteId: 'n', encryptedPayload: 'x', id: '3', timestamp: 1 })).rejects.toBeDefined()
  })
})

describe('incremental sync merge', () => {
  it('applies deletions and upserts by id', () => {
    const row = (id: string, p: string) => ({ id, listId: 'l', encryptedPayload: p, createdAt: 1, updatedAt: 2 })
    const first = mergeSync(undefined, { notes: [row('a', '1'), row('b', '1')], tags: [row('t', '1')], deleted: [], cursor: 5 })
    const next = mergeSync(first, { notes: [row('a', '2')], tags: [], deleted: [{ id: 'b', kind: 'note' }, { id: 't', kind: 'tag' }], cursor: 9 })
    expect(next.notes.map(n => [n.id, n.encryptedPayload])).toEqual([['a', '2']])
    expect(next.tags).toEqual([])
    expect(next.cursor).toBe(9)
  })
})

describe('markdown', () => {
  it('strips script, event handlers and javascript: links', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(2)">\n\n[x](javascript:alert(3)) <a href="javascript:alert(4)">y</a> <div style="position:fixed">z</div>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('style=')
  })

  it('opens external links safely and numbers task checkboxes', () => {
    const html = renderMarkdown('[site](https://example.com)\n\n- [ ] one\n- [x] two')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('data-task-index="0"')
    expect(html).toMatch(/data-task-index="1"[^>]*checked/)
  })

  it('renders attachment references as placeholders resolved later', () => {
    const html = renderMarkdown(`${attachmentMarkdown('abc', 'photo.png', true)} ${attachmentMarkdown('def', 'doc.pdf', false)}`)
    expect(html).toContain('data-attachment-id="abc"')
    expect(html).toContain('data-attachment-id="def"')
    expect(html).not.toContain('attachment:')
  })

  it('toggles the matching checkbox and skips code fences', () => {
    const source = '- [ ] a\n```\n- [ ] not a task\n```\n  - [x] b\n1. [ ] c'
    expect(toggleTask(source, 0)).toBe('- [x] a\n```\n- [ ] not a task\n```\n  - [x] b\n1. [ ] c')
    expect(toggleTask(source, 1)).toBe('- [ ] a\n```\n- [ ] not a task\n```\n  - [ ] b\n1. [ ] c')
    expect(toggleTask(source, 2)).toBe('- [ ] a\n```\n- [ ] not a task\n```\n  - [x] b\n1. [x] c')
    expect(toggleTask(source, 3)).toBe(source)
  })

  it('wraps selections and prefixes lines', () => {
    expect(applyFormat('hello world', 6, 11, 'bold').text).toBe('hello **world**')
    expect(applyFormat('a\nb', 0, 3, 'checklist').text).toBe('- [ ] a\n- [ ] b')
  })
})

describe('notes model', () => {
  const tag = (id: string, title: string, parent_id: string | null = null) => ({ id, title, parent_id, listId: 'l' })
  const tags = [tag('w', 'work'), tag('p', 'projects', 'w'), tag('a', 'alpha', 'p'), tag('h', 'home')]
  const note = (overrides: Partial<ReturnType<typeof model.newNotePayload>> & { id?: string } = {}) =>
    ({ ...model.newNotePayload(), id: 'n', listId: 'l', updatedAt: 0, ...overrides })

  it('builds nested tag paths and survives cycles', () => {
    expect(model.tagPath(tags, 'a')).toBe('work/projects/alpha')
    const cyclic = [tag('x', 'x', 'y'), tag('y', 'y', 'x')]
    expect(model.flattenTagTree(model.buildTagTree(cyclic)).map(n => n.tag.id).sort()).toEqual(['x', 'y'])
  })

  it('filters views like StandardNotes', () => {
    const tagged = note({ tag_ids: ['a'] })
    expect(model.matchesView(tagged, { kind: 'tag', tagId: 'w' }, tags)).toBe(true)
    expect(model.matchesView(tagged, { kind: 'tag', tagId: 'h' }, tags)).toBe(false)
    expect(model.matchesView(note({ tag_ids: ['deleted'] }), { kind: 'untagged' }, tags)).toBe(true)
    expect(model.matchesView(note({ archived: true }), { kind: 'all' }, tags)).toBe(false)
    expect(model.matchesView(note({ archived: true }), { kind: 'archived' }, tags)).toBe(true)
    expect(model.matchesView(note({ trashed_at: 'x', pinned: true }), { kind: 'pinned' }, tags)).toBe(false)
    expect(model.matchesView(note({ trashed_at: 'x' }), { kind: 'trash' }, tags)).toBe(true)
  })

  it('searches protected notes by title only', () => {
    expect(model.matchesSearch(note({ title: 'Bank', text: 'pin 1234', protected: true }), '1234')).toBe(false)
    expect(model.matchesSearch(note({ title: 'Bank', text: 'pin 1234', protected: true }), 'bank')).toBe(true)
    expect(model.matchesSearch(note({ title: 'Bank', text: 'pin 1234' }), '1234')).toBe(true)
  })

  it('sorts pinned notes first', () => {
    const sorted = model.sortNotes([
      note({ id: 'old', title: 'b', edited_at: '2020-01-01' }),
      note({ id: 'new', title: 'a', edited_at: '2024-01-01' }),
      note({ id: 'pin', title: 'c', edited_at: '2019-01-01', pinned: true }),
    ], { key: 'edited', desc: true })
    expect(sorted.map(n => n.id)).toEqual(['pin', 'new', 'old'])
  })

  it('makes readable previews', () => {
    expect(model.notePreview('# Title\n- [ ] **milk** and [link](http://x)\n<b>hi</b>')).toBe('Title milk and link hi')
  })
})

describe('StandardNotes import', async () => {
  const { parseBackupJson, parseBackupFile, assignIds, importId, chunkBySize, ImportError } = await import('../src/lib/notesImport.js')
  const { buildNotesArchive } = await import('../src/lib/notesExport.js')
  const fixture = JSON.parse(await Bun.file(new URL('./fixtures/standardnotes-backup.json', import.meta.url)).text())

  it('maps notes, flags, dates and nested tags', () => {
    const result = parseBackupJson(fixture)
    expect(result.source).toBe('standardnotes')
    expect(result.notes.map(n => n.title)).toEqual(['Plain note', 'Super note'])
    const [plain, superNote] = result.notes
    expect(plain.pinned).toBe(true)
    expect(plain.created_at).toBe('2023-02-01T10:00:00.000Z')
    expect(plain.edited_at).toBe('2023-03-02T10:00:00.000Z')
    expect(plain.tag_ids.sort()).toEqual(['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'])
    expect(superNote.trashed_at).not.toBeNull()
    expect(superNote.protected).toBe(true)
    expect(superNote.locked).toBe(true)
    expect(result.tags.find(t => t.title === 'projects')?.parentSourceId).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('converts Super notes to Markdown', () => {
    const superNote = parseBackupJson(fixture).notes[1]
    expect(superNote.text).toBe('## Heading\n\n**bold** and [link](https://example.com)\n\n- [x] done\n- [ ] todo\n\n```js\nlet x = 1\n```')
  })

  it('rejects encrypted backups with guidance', () => {
    expect(() => parseBackupJson({ items: [{ uuid: 'x', content_type: 'Note', content: '004:abc:def' }] })).toThrow(ImportError)
    expect(() => parseBackupJson({ hello: 1 })).toThrow(ImportError)
  })

  it('reads the backup from a StandardNotes export zip', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const zip = zipSync({ 'Standard Notes Backup and Import File.txt': strToU8(JSON.stringify(fixture)), 'Items/Note/x.txt': strToU8('not json') })
    const result = await parseBackupFile(new File([zip as BlobPart], 'backup.zip'))
    expect(result.notes).toHaveLength(2)
  })

  it('assigns stable, list-scoped UUIDs and remaps references', async () => {
    const result = parseBackupJson(fixture)
    const a = await assignIds(result, 'list-a')
    const again = await assignIds(result, 'list-a')
    const b = await assignIds(result, 'list-b')
    expect(a.notes.map(n => n.id)).toEqual(again.notes.map(n => n.id))
    expect(a.notes[0].id).not.toBe(b.notes[0].id)
    expect(a.notes[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const work = a.tags.find(t => t.payload.title === 'work')!
    const projects = a.tags.find(t => t.payload.title === 'projects')!
    expect(projects.payload.parent_id).toBe(work.id)
    expect(a.notes[0].payload.tag_ids.sort()).toEqual([work.id, projects.id].sort())
    expect(await importId('l', 's')).toBe(await importId('l', 's'))
  })

  it('chunks by count and size', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), encryptedPayload: 'x'.repeat(40) }))
    expect(chunkBySize(items, 2).map(c => c.length)).toEqual([2, 2, 1])
    expect(chunkBySize(items, 100, 100).map(c => c.length)).toEqual([2, 2, 1])
  })

  it('round-trips through this app’s own export', async () => {
    const { unzipSync, strFromU8 } = await import('fflate')
    const notes = parseBackupJson(fixture).notes.map(({ sourceId, ...n }) => ({ ...n, id: sourceId, listId: 'l', updatedAt: 0 }))
    const tags = parseBackupJson(fixture).tags.map(t => ({ id: t.sourceId, listId: 'l', title: t.title, parent_id: t.parentSourceId }))
    const zip = await buildNotesArchive({ lists: [{ id: 'l', name: 'Personal' }], notes, tags, attachments: [], fetchAttachment: async () => new Blob() })
    const files = unzipSync(zip)
    expect(Object.keys(files).sort()).toEqual(['Personal/Plain note.md', 'Personal/Trash/Super note.md', 'notes-backup.json'])
    expect(strFromU8(files['Personal/Plain note.md'])).toContain('tags: ["work", "work/projects"]')
    const restored = parseBackupJson(JSON.parse(strFromU8(files['notes-backup.json'])))
    expect(restored.source).toBe('tasks')
    expect(restored.notes.map(n => n.text)).toEqual(notes.map(n => n.text))
    expect(restored.tags.find(t => t.title === 'projects')?.parentSourceId).toBe('33333333-3333-4333-8333-333333333333')
  })
})

describe('Super table conversion', async () => {
  const { lexicalToMarkdown } = await import('../src/lib/notesImport.js')
  const cell = (text: string) => ({ type: 'tablecell', children: [{ type: 'paragraph', children: [{ type: 'text', text, format: 0 }] }] })
  it('escapes pipes and backslashes and keeps cells on one line', () => {
    const md = lexicalToMarkdown({ root: { type: 'root', children: [{ type: 'table', children: [
      { type: 'tablerow', children: [cell('path'), cell('note')] },
      { type: 'tablerow', children: [cell('C:\\dir\\'), cell('a|b')] },
      { type: 'tablerow', children: [{ type: 'tablecell', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'x', format: 0 }, { type: 'linebreak' }, { type: 'text', text: 'y', format: 0 }] }] }, cell('z')] },
    ] }] } })
    expect(md).toBe('| path | note |\n| --- | --- |\n| C:\\\\dir\\\\ | a\\|b |\n| x y | z |')
  })
})

describe('backup review regressions', async () => {
  const { safeFilename, buildNotesArchive } = await import('../src/lib/notesExport.js')
  const { parseBackupFile } = await import('../src/lib/notesImport.js')
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate')

  it('never exports dot directories and makes attachment links portable', async () => {
    expect(safeFilename('..')).toBe('Untitled')
    expect(safeFilename('.')).toBe('Untitled')
    const id = '12345678-1234-4234-8234-123456789abc'
    const zip = await buildNotesArchive({
      lists: [{ id: 'l', name: '..' }],
      notes: [{ ...model.newNotePayload(), id: 'n', listId: 'l', updatedAt: 1, text: `![image](attachment:${id})`, archived: true }],
      tags: [], attachments: [{ id, name: 'my image.png', mime: 'image/png', file_key: '', size: 1, uploaded: true, createdAt: 1 }],
      fetchAttachment: async () => new Blob(['x']),
    })
    const files = unzipSync(zip)
    expect(Object.keys(files).some(name => name.startsWith('../'))).toBe(false)
    const md = Object.keys(files).find(name => name.endsWith('.md'))!
    expect(strFromU8(files[md])).toContain(`../../attachments/${id}-my%20image.png`)
  })

  it('skips unrelated JSON files before finding a valid backup in a zip', async () => {
    const zip = zipSync({ 'metadata.json': strToU8('{"hello":1}'), 'backup.json': strToU8('{"items":[]}') })
    const result = await parseBackupFile(new File([zip as BlobPart], 'backup.zip'))
    expect(result.notes).toEqual([])
  })

  it('bounds decompression before allocating a large text entry', async () => {
    const zip = zipSync({ 'backup.json': new Uint8Array(65 * 1024 * 1024) })
    await expect(parseBackupFile(new File([zip as BlobPart], 'backup.zip'))).rejects.toThrow('64 MB')
  })
})
