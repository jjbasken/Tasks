import { describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'
import { act, useState } from 'react'
import type { NotePayload } from '@tasks/shared'
import { NoteEditor } from '../src/components/notes/NoteEditor.js'
import { newNotePayload, type DecryptedNote } from '../src/lib/notesModel.js'

describe('editor save lifecycle', () => {
  it('does not undo protection when pending typing is flushed on unmount', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: () => 0 })
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.getElementById('root')!)
    const saved: NotePayload[] = []
    function Harness() {
      const [note, setNote] = useState<DecryptedNote>({ ...newNotePayload(), id: 'n', listId: 'l', updatedAt: 1 })
      const save = (_: DecryptedNote, payload: NotePayload) => {
        saved.push(payload)
        setNote(n => ({ ...n, ...payload }))
        return true
      }
      return <NoteEditor note={note} tags={[]} listName="Personal" unlocked={false}
        onSave={save} onAction={(_, latest) => save(note, { ...latest, protected: true })}
        onAddTag={() => null} onRequestUnlock={() => {}} />
    }
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => { (document.querySelector('[title="Bold (Ctrl+B)"]') as HTMLButtonElement).click() })
      await act(async () => { (document.querySelector('.note-menu-btn') as HTMLButtonElement).click() })
      await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Protect with passphrase')!.click() })
      expect(saved.at(-1)?.protected).toBe(true)
      expect(saved.at(-1)?.text).toBe('**text**')
      expect(document.body.textContent).toContain('Unlock to view')
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
    }
  })
})
