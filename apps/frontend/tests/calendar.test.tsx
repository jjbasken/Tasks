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
        <CalendarView tasks={[task]} onToggle={() => {}} onClickTask={t => opened.push(t.id)} onMove={() => {}} onQuickAdd={() => true} onOpenAdd={() => {}} />,
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

describe('calendar add from a day', () => {
  const noop = () => {}
  async function renderDay(date: string, handlers: { quick?: (d: string, t: string) => boolean | Promise<boolean>; open?: (d: string, t?: string) => void } = {}) {
    const dom = await setupDom()
    const { createRoot } = await import('react-dom/client')
    const { DndContext } = await import('@dnd-kit/core')
    const { CalendarDay } = await import('../src/components/calendar/CalendarDay.js')
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(
      <DndContext>
        <CalendarDay
          date={date} today={toLocalISODate(new Date())} items={[]} isDragging={false}
          onToggle={noop} onClickTask={noop}
          onQuickAdd={handlers.quick ?? (() => true)} onOpenAdd={handlers.open ?? noop}
        />
      </DndContext>,
    ))
    const cleanup = async () => { await act(async () => root.unmount()); dom.window.close() }
    return { dom, cleanup }
  }

  async function type(dom: JSDOM, input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  async function press(dom: JSDOM, input: HTMLInputElement, key: string) {
    await act(async () => { input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })) })
  }

  const offset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return toLocalISODate(d) }

  it('offers no add button on past days', async () => {
    const { cleanup } = await renderDay(offset(-1))
    try {
      expect(document.querySelector('.cal-add-btn')).toBeNull()
    } finally { await cleanup() }
  })

  it('quick-adds on Enter for today and ignores blank titles', async () => {
    const date = toLocalISODate(new Date())
    const added: [string, string][] = []
    const { dom, cleanup } = await renderDay(date, { quick: (d, t) => { added.push([d, t]); return true } })
    try {
      const btn = document.querySelector('.cal-add-btn') as HTMLButtonElement
      expect(btn).not.toBeNull()
      await act(async () => btn.click())
      const input = document.querySelector('.cal-quick-input') as HTMLInputElement
      await press(dom, input, 'Enter')
      expect(added).toEqual([])
      await type(dom, input, '  Buy milk ')
      await press(dom, input, 'Enter')
      expect(added).toEqual([[date, 'Buy milk']])
      // Stays open and cleared for the next task.
      expect((document.querySelector('.cal-quick-input') as HTMLInputElement).value).toBe('')
      await press(dom, input, 'Escape')
      expect(document.querySelector('.cal-quick-input')).toBeNull()
    } finally { await cleanup() }
  })

  it('keeps the title when the task could not be saved', async () => {
    const { dom, cleanup } = await renderDay(toLocalISODate(new Date()), { quick: async () => false })
    try {
      await act(async () => (document.querySelector('.cal-add-btn') as HTMLButtonElement).click())
      const input = document.querySelector('.cal-quick-input') as HTMLInputElement
      await type(dom, input, 'Buy milk')
      await press(dom, input, 'Enter')
      expect((document.querySelector('.cal-quick-input') as HTMLInputElement).value).toBe('Buy milk')
    } finally { await cleanup() }
  })

  it('ignores Enter while an input method is composing', async () => {
    const added: string[] = []
    const { dom, cleanup } = await renderDay(toLocalISODate(new Date()), { quick: (_d, t) => { added.push(t); return true } })
    try {
      await act(async () => (document.querySelector('.cal-add-btn') as HTMLButtonElement).click())
      const input = document.querySelector('.cal-quick-input') as HTMLInputElement
      await type(dom, input, 'にほん')
      await act(async () => { input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })) })
      expect(added).toEqual([])
      expect((document.querySelector('.cal-quick-input') as HTMLInputElement).value).toBe('にほん')
      await press(dom, input, 'Enter')
      expect(added).toEqual(['にほん'])
    } finally { await cleanup() }
  })

  it('opens the full editor with the date and typed title from More…', async () => {
    const date = offset(10)
    const opened: [string, string | undefined][] = []
    const { dom, cleanup } = await renderDay(date, { open: (d, t) => opened.push([d, t]) })
    try {
      await act(async () => (document.querySelector('.cal-add-btn') as HTMLButtonElement).click())
      await type(dom, document.querySelector('.cal-quick-input') as HTMLInputElement, 'Dentist')
      await act(async () => (document.querySelector('.cal-quick-more') as HTMLButtonElement).click())
      expect(opened).toEqual([[date, 'Dentist']])
      expect(document.querySelector('.cal-quick-add')).toBeNull()
    } finally { await cleanup() }
  })
})

describe('task editor prefill', () => {
  it('starts a new task on the given date, in Later when it is over a week out', async () => {
    const dom = await setupDom()
    const { createRoot } = await import('react-dom/client')
    const { TaskDetail } = await import('../src/components/TaskDetail.js')
    const d = new Date(); d.setDate(d.getDate() + 10)
    const date = toLocalISODate(d)
    const root = createRoot(document.getElementById('root')!)
    try {
      await act(async () => root.render(
        <TaskDetail task={null} listId="l1" listKeyB64="k" onClose={() => {}} initialDueDate={date} initialTitle="Dentist" />,
      ))
      const inputs = [...document.querySelectorAll('input.field-input')] as HTMLInputElement[]
      expect(inputs[0].value).toBe('Dentist')
      expect(inputs.find(i => i.type === 'date')!.value).toBe(date)
      expect((document.querySelector('select.field-select') as HTMLSelectElement).value).toBe('later')
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
    }
  })
})

describe('calendar default view toggle', () => {
  it('is disabled with a reason while unavailable, such as during a pending save', async () => {
    const dom = await setupDom()
    const { createRoot } = await import('react-dom/client')
    const { CalendarView } = await import('../src/components/calendar/CalendarView.js')
    const root = createRoot(document.getElementById('root')!)
    const noop = () => {}
    const render = (reason: string | null) => root.render(
      <CalendarView tasks={[]} onToggle={noop} onClickTask={noop} onMove={noop} onQuickAdd={() => true} onOpenAdd={noop}
        isDefault onToggleDefault={noop} defaultDisabledReason={reason} />,
    )
    try {
      await act(async () => render('Saving…'))
      const box = document.querySelector('.cal-default-toggle input') as HTMLInputElement
      expect(box.checked).toBe(true)
      expect(box.disabled).toBe(true)
      expect(document.querySelector('.cal-default-toggle')!.getAttribute('title')).toBe('Saving…')
      await act(async () => render(null))
      expect((document.querySelector('.cal-default-toggle input') as HTMLInputElement).disabled).toBe(false)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
    }
  })
})

describe('calendar preferences on TasksPage', () => {
  async function withTasksPage(
    initialView: 'now' | 'calendar',
    run: (page: {
      dom: JSDOM
      mountTasks: (show: boolean) => Promise<void>
      refreshDefault: (view: 'now' | 'calendar') => Promise<void>
      finishSave: () => Promise<void>
    }) => Promise<void>,
  ) {
    const dom = await setupDom()
    const { createRoot } = await import('react-dom/client')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { httpLink } = await import('@trpc/client')
    const { getQueryKey } = await import('@trpc/react-query')
    const { MemoryRouter } = await import('react-router')
    const { AuthProvider } = await import('../src/hooks/useAuth.js')
    const { session } = await import('../src/lib/session.js')
    const { trpc } = await import('../src/lib/trpc.js')
    const { TasksPage } = await import('../src/routes/TasksPage.js')

    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    const rows = (defaultView: 'now' | 'calendar') => [
      { id: 'personal', isPersonal: true, defaultView, encryptedName: '', encryptedListKey: '' },
    ]
    const listKey = getQueryKey(trpc.lists.list, undefined, 'query')
    queryClient.setQueryData(listKey, rows(initialView))
    const saveRequest = Promise.withResolvers<Response>()
    const saveStarted = Promise.withResolvers<void>()
    let savedView = initialView
    let requestedView = initialView
    const client = trpc.createClient({
      links: [httpLink({
        url: 'http://localhost/trpc',
        fetch: async (url, options) => {
          if (String(url).endsWith('/lists.setDefaultView')) {
            requestedView = JSON.parse(String(options?.body)).view
            saveStarted.resolve()
            return saveRequest.promise
          }
          return Response.json({ result: { data: rows(savedView) } })
        },
      })],
    })
    session.setToken('x.e30.x')
    session.setStretchKey(new Uint8Array(32))
    session.setPrivateKey('test')
    session.setPublicKey('test')
    const root = createRoot(document.getElementById('root')!)
    const mountTasks = (show: boolean) => act(async () => {
      root.render(
        <trpc.Provider client={client} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <MemoryRouter>{show && <TasksPage />}</MemoryRouter>
            </AuthProvider>
          </QueryClientProvider>
        </trpc.Provider>,
      )
    })
    try {
      await mountTasks(true)
      await run({
        dom, mountTasks,
        refreshDefault: view => act(async () => {
          queryClient.setQueryData(listKey, rows(view))
          await new Promise(resolve => setTimeout(resolve, 0))
        }),
        finishSave: () => act(async () => {
          await saveStarted.promise
          const settled = new Promise<void>(resolve => {
            const unsubscribe = queryClient.getMutationCache().subscribe(() => {
              if (queryClient.isMutating() > 0) return
              unsubscribe()
              resolve()
            })
          })
          savedView = requestedView
          saveRequest.resolve(Response.json({ result: { data: { ok: true } } }))
          await settled
          await new Promise(resolve => setTimeout(resolve, 0))
        }),
      })
    } finally {
      await mountTasks(false)
      await act(async () => root.unmount())
      queryClient.clear()
      session.clear()
      dom.window.close()
    }
  }

  it('replaces an open new-task draft when More… is used again on the same day', async () => {
    await withTasksPage('calendar', async ({ dom }) => {
      const openWith = async (title: string) => {
        await act(async () => document.querySelector<HTMLButtonElement>('.cal-add-btn')!.click())
        const input = document.querySelector<HTMLInputElement>('.cal-quick-input')!
        await act(async () => {
          Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, title)
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
        })
        await act(async () => document.querySelector<HTMLButtonElement>('.cal-quick-more')!.click())
        return document.querySelector<HTMLInputElement>('.task-panel input.field-input')!.value
      }
      expect(await openWith('Dentist')).toBe('Dentist')
      expect(await openWith('Haircut')).toBe('Haircut')
    })
  })

  it('keeps the calendar draft when the default refreshes to Now', async () => {
    await withTasksPage('calendar', async ({ dom, refreshDefault }) => {
      await act(async () => document.querySelector<HTMLButtonElement>('.cal-add-btn')!.click())
      const input = document.querySelector<HTMLInputElement>('.cal-quick-input')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Dentist')
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
      await refreshDefault('now')
      expect(document.querySelector('.tab-btn.active')?.textContent).toBe('Calendar')
      expect(document.querySelector<HTMLInputElement>('.cal-quick-input')?.value).toBe('Dentist')
    })
  })

  it('keeps the default toggle disabled across a remount while the save is pending', async () => {
    await withTasksPage('calendar', async ({ mountTasks, finishSave }) => {
      const checkbox = () => document.querySelector<HTMLInputElement>('.cal-default-toggle input')!
      await act(async () => {
        checkbox().click()
        await new Promise(resolve => setTimeout(resolve, 0))
      })
      expect(checkbox().disabled).toBe(true)
      await mountTasks(false)
      await mountTasks(true)
      // The optimistic default is Now, so reopen the Calendar tab.
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.tab-btn')]
        .find(button => button.textContent === 'Calendar')!.click())
      expect(checkbox().checked).toBe(false)
      expect(checkbox().disabled).toBe(true)
      await finishSave()
      expect(checkbox().disabled).toBe(false)
    })
  })
})
