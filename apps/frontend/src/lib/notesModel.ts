import type { NotePayload, TagPayload } from '@tasks/shared'

export type DecryptedNote = NotePayload & { id: string; listId: string; updatedAt: number }
export type DecryptedTag = TagPayload & { id: string; listId: string }

export type NoteView =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'untagged' }
  | { kind: 'archived' }
  | { kind: 'trash' }
  | { kind: 'files' }
  | { kind: 'tag'; tagId: string }

export type SortKey = 'edited' | 'created' | 'title'
export type SortOrder = { key: SortKey; desc: boolean }

export function newNotePayload(overrides: Partial<NotePayload> = {}): NotePayload {
  const now = new Date().toISOString()
  return {
    title: '', text: '', editor: 'markdown', tag_ids: [], attachment_ids: [],
    pinned: false, archived: false, trashed_at: null, locked: false, protected: false,
    created_at: now, edited_at: now, ...overrides,
  }
}

/** Fill fields a payload from an older or foreign writer may lack. */
export function normalizeNote(payload: Partial<NotePayload>): NotePayload {
  return { ...newNotePayload(), ...payload, tag_ids: payload.tag_ids ?? [], attachment_ids: payload.attachment_ids ?? [] }
}

export function stripNote(note: DecryptedNote): NotePayload {
  const { id: _id, listId: _listId, updatedAt: _updatedAt, ...payload } = note
  return payload
}

/** Every tag id in the subtree rooted at `tagId`, including itself. */
export function tagSubtree(tags: DecryptedTag[], tagId: string): Set<string> {
  const result = new Set([tagId])
  let grew = true
  while (grew) {
    grew = false
    for (const tag of tags) {
      if (tag.parent_id && result.has(tag.parent_id) && !result.has(tag.id)) { result.add(tag.id); grew = true }
    }
  }
  return result
}

export type TagNode = { tag: DecryptedTag; children: TagNode[]; depth: number }

/** Nested tree, alphabetical per level. Orphans and cycles surface at the root. */
export function buildTagTree(tags: DecryptedTag[]): TagNode[] {
  const byId = new Map(tags.map(t => [t.id, t]))
  const children = new Map<string | null, DecryptedTag[]>()
  for (const tag of tags) {
    let parent = tag.parent_id && byId.has(tag.parent_id) ? tag.parent_id : null
    // A cycle (possible after concurrent re-parenting) would hide every tag in it.
    if (parent && tagSubtree(tags, tag.id).has(parent)) parent = null
    children.set(parent, [...(children.get(parent) ?? []), tag])
  }
  const build = (parent: string | null, depth: number): TagNode[] =>
    (children.get(parent) ?? [])
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(tag => ({ tag, depth, children: build(tag.id, depth + 1) }))
  return build(null, 0)
}

export function flattenTagTree(nodes: TagNode[]): TagNode[] {
  return nodes.flatMap(node => [node, ...flattenTagTree(node.children)])
}

/** Full path such as "work/projects/alpha", for chips and pickers. */
export function tagPath(tags: DecryptedTag[], tagId: string): string {
  const byId = new Map(tags.map(t => [t.id, t]))
  const parts: string[] = []
  const seen = new Set<string>()
  let current = byId.get(tagId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.title)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return parts.join('/')
}

export function liveTagIds(note: NotePayload, tags: DecryptedTag[]) {
  const known = new Set(tags.map(t => t.id))
  return note.tag_ids.filter(id => known.has(id))
}

export function matchesView(note: DecryptedNote, view: NoteView, tags: DecryptedTag[]): boolean {
  if (view.kind === 'trash') return !!note.trashed_at
  if (note.trashed_at) return false
  if (view.kind === 'archived') return note.archived
  if (view.kind === 'pinned') return note.pinned
  if (note.archived) return false
  if (view.kind === 'untagged') return liveTagIds(note, tags).length === 0
  if (view.kind === 'tag') {
    const subtree = tagSubtree(tags, view.tagId)
    return note.tag_ids.some(id => subtree.has(id))
  }
  return true
}

/** Protected notes are searched by title only, so the list never hints at hidden content. */
export function matchesSearch(note: DecryptedNote, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (note.title.toLowerCase().includes(q)) return true
  return !note.protected && note.text.toLowerCase().includes(q)
}

export function sortNotes(notes: DecryptedNote[], order: SortOrder): DecryptedNote[] {
  const value = (n: DecryptedNote) => order.key === 'title' ? n.title.toLowerCase() : order.key === 'created' ? n.created_at : n.edited_at
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const va = value(a), vb = value(b)
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return order.desc ? -cmp : cmp
  })
}

/** Plain-text preview line for the note list. */
export function notePreview(text: string, length = 140): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length)
}

export function displayTitle(note: Pick<NotePayload, 'title' | 'text' | 'protected'>): string {
  if (note.title.trim()) return note.title
  if (note.protected) return 'Untitled'
  return notePreview(note.text, 60) || 'Untitled'
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}
