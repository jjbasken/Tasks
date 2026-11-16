import { describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import type { ClientRect, CollisionDetection } from '@dnd-kit/core'
import { toLocalISODate } from '@tasks/shared'
import type { DecryptedTask } from '../src/hooks/useTasks.js'

const rect = (left: number, top: number, width: number, height: number): ClientRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height })

async function setupDom() {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' })
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  return dom
}

describe('calendar collision detection', () => {
  async function detect(pointer: { x: number; y: number } | null) {
    await setupDom()
    const { collision } = await import('../src/components/calendar/CalendarView.js')
    const tray = rect(0, 0, 100, 400)
    const day = rect(110, 0, 100, 100)
    const droppableRects = new Map([['unscheduled', tray], ['2026-11-20', day]])
    const containers = [...droppableRects.keys()].map(id => ({ id, rect: { current: droppableRects.get(id)! }, disabled: false, data: { current: {} }, node: { current: null } }))
    const args = {
      active: { id: 't', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      // The dragged chip still overlaps the tray's right edge.
      collisionRect: rect(80, 10, 60, 20),
      droppableRects,
      droppableContainers: containers,
      pointerCoordinates: pointer,
    } as unknown as Parameters<CollisionDetection>[0]
    return collision(args).map(c => c.id)
  }

  it('ignores a pointer release outside every target even when the chip overlaps one', async () => {
    expect(await detect({ x: 102, y: 20 })).toEqual([])
  })
  it('uses the pointer position when it is inside a target', async () => {
    expect(await detect({ x: 150, y: 20 })).toEqual(['2026-11-20'])
    expect(await detect({ x: 50, y: 20 })).toEqual(['unscheduled'])
  })
  it('falls back to overlap for keyboard drags, which have no pointer', async () => {
    expect(await detect(null)).toContain('unscheduled')
  })
})

describe('calendar chip keyboard access', () => {
  it('opens a task from a native title button and drags only from the handle', async () => {
    const dom = await setupDom()
    const { createRoot } = await import('react-dom/client')
    const { CalendarView } = await import('../src/components/calendar/CalendarView.js')
    const today = toLocalISODate(new Date())
    const task: DecryptedTask = {
      id: 't1', title: 'Water plants', notes: null, bucket: 'now', status: 'active', rrule: null,
      due_date: today, completed_at: null, createdAt: 1, updatedAt: 1,
    }
    const opened: string[] = []
    const root = createRoot(document.getElementById('root')!)
    try {
      await act(async () => root.render(
        <CalendarView tasks={[task]} onToggle={() => {}} onClickTask={t => opened.push(t.id)} onMove={() => {}} />,
      ))
      const chip = document.querySelector('.cal-chip-active')!
      const titleBtn = chip.querySelector('.cal-chip-title') as HTMLButtonElement
      const handle = chip.querySelector('.cal-chip-handle') as HTMLElement

      expect(titleBtn.tagName).toBe('BUTTON')
      await act(async () => titleBtn.click())
      expect(opened).toEqual(['t1'])

      // The title and chip carry no keyboard drag activation; the handle does.
      expect(chip.getAttribute('tabindex')).toBeNull()
      expect(titleBtn.getAttribute('aria-roledescription')).toBeNull()
      expect(handle.getAttribute('tabindex')).toBe('0')
      expect(handle.getAttribute('aria-roledescription')).toBe('drag handle')

      // Enter on the title must not start a drag (the chip would get the dragging class).
      await act(async () => {
        titleBtn.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
      })
      expect(chip.classList.contains('cal-chip-dragging')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
    }
  })
})
