import { describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { addDays, toLocalISODate } from '@tasks/shared'

type Bucket = 'now' | 'later'

async function render(props: {
  bucket?: Bucket
  add?: (title: string, due: string | null) => Bucket | null | Promise<Bucket | null>
  open?: (title?: string, due?: string) => void
} = {}) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' })
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  const { createRoot } = await import('react-dom/client')
  const { QuickAddTask } = await import('../src/components/QuickAddTask.js')
  const root = createRoot(document.getElementById('root')!)
  const bucket = props.bucket ?? 'now'
  await act(async () => root.render(
    <QuickAddTask bucket={bucket} onAdd={props.add ?? (() => bucket)} onOpenAdd={props.open ?? (() => {})} />,
  ))
  const input = () => document.querySelector('.quick-add-input') as HTMLInputElement
  const type = async (value: string) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input(), value)
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  const press = async (key: string, init: KeyboardEventInit = {}) => {
    await act(async () => { input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, ...init })) })
  }
  const cleanup = async () => { await act(async () => root.unmount()); dom.window.close() }
  return { input, type, press, cleanup }
}

describe('list quick-add', () => {
  const today = toLocalISODate(new Date())

  it('adds plain titles on Enter, clears for the next one, and ignores blanks', async () => {
    const added: [string, string | null][] = []
    const q = await render({ add: (t, d) => { added.push([t, d]); return 'now' } })
    try {
      await q.press('Enter')
      await q.type('   ')
      await q.press('Enter')
      expect(added).toEqual([])
      await q.type('  Buy   milk ')
      await q.press('Enter')
      expect(added).toEqual([['Buy milk', null]])
      expect(q.input().value).toBe('')
      expect(document.querySelector('.quick-add-status')!.textContent).toBe('')
    } finally { await q.cleanup() }
  })

  it('previews and submits a trailing due date', async () => {
    const added: [string, string | null][] = []
    const q = await render({ add: (t, d) => { added.push([t, d]); return 'now' } })
    try {
      await q.type('Pay rent tomorrow')
      expect(document.querySelector('.quick-add-due')!.textContent).toBe('Tomorrow')
      await q.press('Enter')
      expect(added).toEqual([['Pay rent', addDays(today, 1)]])
      expect(document.querySelector('.quick-add-due')).toBeNull()
    } finally { await q.cleanup() }
  })

  it('says where a task went when it lands in the other bucket', async () => {
    const q = await render({ bucket: 'later', add: () => 'now' })
    try {
      await q.type('Call mom today')
      await q.press('Enter')
      expect(document.querySelector('.quick-add-status')!.textContent).toBe('Added “Call mom” to Now')
    } finally { await q.cleanup() }
  })

  it('keeps the text when the task could not be saved', async () => {
    const q = await render({ add: async () => null })
    try {
      await q.type('Buy milk')
      await q.press('Enter')
      expect(q.input().value).toBe('Buy milk')
    } finally { await q.cleanup() }
  })

  it('ignores Enter while an input method is composing, and clears on Escape', async () => {
    const added: string[] = []
    const q = await render({ add: t => { added.push(t); return 'now' } })
    try {
      await q.type('にほん')
      await q.press('Enter', { isComposing: true })
      expect(added).toEqual([])
      expect(q.input().value).toBe('にほん')
      await q.press('Escape')
      expect(q.input().value).toBe('')
    } finally { await q.cleanup() }
  })

  it('hands the parsed draft to the full editor via More…', async () => {
    const opened: [string | undefined, string | undefined][] = []
    const q = await render({ open: (t, d) => opened.push([t, d]) })
    try {
      expect(document.querySelector('.quick-add-more')).toBeNull()
      await q.type('Dentist by fri')
      await act(async () => (document.querySelector('.quick-add-more') as HTMLButtonElement).click())
      expect(opened).toHaveLength(1)
      expect(opened[0][0]).toBe('Dentist')
      expect(opened[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(q.input().value).toBe('')
    } finally { await q.cleanup() }
  })
})
