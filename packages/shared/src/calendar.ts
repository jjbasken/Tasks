import type { TaskPayload } from './types.js'
import { nextOccurrenceDate, occurrencesBetween } from './rrule-helpers.js'

/** Local calendar date as YYYY-MM-DD (not UTC, unlike toISOString). */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD into a local Date at noon (noon avoids DST edge cases). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toLocalISODate(d)
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** Sunday on or before the given date. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -parseISODate(iso).getDay())
}

/** The 7 dates (Sunday..Saturday) of the week containing anchor. */
export function weekDays(anchor: string): string[] {
  const start = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** 6x7 = 42 dates covering the month (0-based month), starting on a Sunday. */
export function monthGrid(year: number, month: number): string[] {
  const first = toLocalISODate(new Date(year, month, 1, 12))
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export type CalendarTask = Pick<TaskPayload, 'status' | 'due_date' | 'completed_at' | 'rrule'> & { id: string }

export type PlacedKind = 'overdue' | 'active' | 'ghost' | 'done'

export type Placed<T extends CalendarTask> = {
  task: T
  kind: PlacedKind
  /** Days past the stored due date (overdue only). */
  daysLate?: number
}

const KIND_ORDER: Record<PlacedKind, number> = { overdue: 0, active: 1, ghost: 2, done: 3 }

/**
 * Lay tasks out on a calendar range [rangeStart, rangeEnd] (inclusive, YYYY-MM-DD).
 * Active tasks past due are drawn on `today` (display-only rollover); undated active
 * tasks go to `unscheduled`; done tasks land on their local completion date; recurring
 * active tasks also get ghost previews of later occurrences.
 */
export function placeTasks<T extends CalendarTask>(
  tasks: T[],
  rangeStart: string,
  rangeEnd: string,
  today: string,
): { byDate: Map<string, Placed<T>[]>; unscheduled: T[] } {
  const byDate = new Map<string, Placed<T>[]>()
  const unscheduled: T[] = []
  const inRange = (d: string) => d >= rangeStart && d <= rangeEnd
  const put = (d: string, p: Placed<T>) => {
    if (!inRange(d)) return
    const arr = byDate.get(d)
    if (arr) arr.push(p)
    else byDate.set(d, [p])
  }

  for (const task of tasks) {
    if (task.status === 'done') {
      if (task.completed_at) put(toLocalISODate(new Date(task.completed_at)), { task, kind: 'done' })
      continue
    }
    if (!task.due_date) {
      unscheduled.push(task)
      continue
    }
    const overdue = task.due_date < today
    const shownOn = overdue ? today : task.due_date
    put(shownOn, overdue
      ? { task, kind: 'overdue', daysLate: daysBetween(task.due_date, today) }
      : { task, kind: 'active' })

    if (task.rrule && rangeEnd > shownOn) {
      const from = shownOn >= rangeStart ? addDays(shownOn, 1) : rangeStart
      for (const d of occurrencesBetween(task.rrule, task.due_date, from, rangeEnd)) {
        if (d > shownOn) put(d, { task, kind: 'ghost' })
      }
    }
  }

  for (const arr of byDate.values()) {
    arr.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.daysLate ?? 0) - (a.daysLate ?? 0))
  }
  return { byDate, unscheduled }
}

/** Bucket for a task due on `due`: within 7 days of today is 'now', otherwise 'later'. */
export function bucketForDueDate(due: string, today: string): 'now' | 'later' {
  return daysBetween(today, due) > 7 ? 'later' : 'now'
}

/**
 * Due date for the occurrence created when a recurring task is completed on `today`.
 * Catch-up rule: missed occurrences are skipped. The next date is the first occurrence
 * after the later of the due date and today, aligned to the rule anchored at the due
 * date. An overdue task already sits on today's cell, so this is the first ghost the
 * calendar previews after it. Undated tasks anchor at today.
 */
export function nextDueOnCompletion(rrule: string, dueDate: string | null, today: string): string | null {
  const anchor = dueDate ?? today
  return nextOccurrenceDate(rrule, anchor, anchor > today ? anchor : today)
}
