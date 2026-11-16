import { describe, it, expect } from 'bun:test'
import {
  toLocalISODate, addDays, daysBetween, monthGrid, weekDays, placeTasks, bucketForDueDate,
  type CalendarTask,
} from '../src/calendar.js'

const task = (over: Partial<CalendarTask> & { id: string }): CalendarTask => ({
  status: 'active', due_date: null, completed_at: null, rrule: null, ...over,
})

describe('date helpers', () => {
  it('toLocalISODate uses local, not UTC, date', () => {
    expect(toLocalISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(toLocalISODate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('daysBetween counts whole days across DST', () => {
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3)
    expect(daysBetween('2026-11-16', '2026-11-13')).toBe(-3)
  })
})

describe('grids', () => {
  it('monthGrid has 42 days starting on a Sunday', () => {
    const g = monthGrid(2026, 10) // November 2026, starts on a Sunday
    expect(g).toHaveLength(42)
    expect(g[0]).toBe('2026-11-01')
    const feb = monthGrid(2026, 1) // Feb 1 2026 is a Sunday too; check a mid-week start
    expect(feb[0]).toBe('2026-02-01')
    const dec = monthGrid(2026, 11) // Dec 1 2026 is a Tuesday
    expect(dec[0]).toBe('2026-11-29')
    expect(dec[2]).toBe('2026-12-01')
  })
  it('weekDays returns Sunday..Saturday', () => {
    expect(weekDays('2026-11-18')).toEqual([
      '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21',
    ])
  })
})

describe('placeTasks', () => {
  const today = '2026-11-16'
  const start = '2026-11-15'
  const end = '2026-11-28'

  it('places active, overdue, undated and done tasks', () => {
    const done = new Date(2026, 10, 15, 9).toISOString()
    const { byDate, unscheduled } = placeTasks([
      task({ id: 'future', due_date: '2026-11-20' }),
      task({ id: 'late', due_date: '2026-11-13' }),
      task({ id: 'later', due_date: '2026-11-10' }),
      task({ id: 'nodate' }),
      task({ id: 'done', status: 'done', due_date: '2026-11-14', completed_at: done }),
      task({ id: 'outside', due_date: '2026-12-25' }),
    ], start, end, today)

    expect(byDate.get('2026-11-20')?.map(p => p.task.id)).toEqual(['future'])
    const todays = byDate.get(today)!
    expect(todays.map(p => [p.task.id, p.kind, p.daysLate])).toEqual([
      ['later', 'overdue', 6],
      ['late', 'overdue', 3],
    ])
    expect(byDate.get('2026-11-15')?.map(p => [p.task.id, p.kind])).toEqual([['done', 'done']])
    expect(unscheduled.map(t => t.id)).toEqual(['nodate'])
    expect([...byDate.values()].flat().some(p => p.task.id === 'outside')).toBe(false)
  })

  it('adds ghost occurrences after the shown date only', () => {
    const { byDate } = placeTasks([
      task({ id: 'weekly', due_date: '2026-11-17', rrule: 'FREQ=WEEKLY' }),
    ], start, end, today)
    expect(byDate.get('2026-11-17')?.[0].kind).toBe('active')
    expect(byDate.get('2026-11-24')?.[0].kind).toBe('ghost')
    expect([...byDate.values()].flat().filter(p => p.kind === 'ghost')).toHaveLength(1)
  })

  it('ghosts of an overdue recurring task never land on or before today', () => {
    const { byDate } = placeTasks([
      task({ id: 'daily', due_date: '2026-11-14', rrule: 'FREQ=DAILY' }),
    ], start, end, today)
    expect(byDate.get(today)?.map(p => p.kind)).toEqual(['overdue'])
    expect(byDate.get('2026-11-15')).toBeUndefined()
    expect(byDate.get('2026-11-17')?.[0].kind).toBe('ghost')
  })

  it('sorts overdue before active before ghost before done', () => {
    const { byDate } = placeTasks([
      task({ id: 'd', status: 'done', completed_at: new Date(2026, 10, 16, 10).toISOString() }),
      task({ id: 'g', due_date: '2026-11-09', rrule: 'FREQ=WEEKLY' }), // overdue, ghost next Monday
      task({ id: 'a', due_date: today }),
      task({ id: 'r', due_date: '2026-11-15', rrule: 'FREQ=DAILY' }),
    ], start, end, today)
    expect(byDate.get(today)!.map(p => `${p.task.id}:${p.kind}`)).toEqual(['g:overdue', 'r:overdue', 'a:active', 'd:done'])
  })
})

describe('bucketForDueDate', () => {
  it('is now within 7 days and later beyond', () => {
    expect(bucketForDueDate('2026-11-23', '2026-11-16')).toBe('now')
    expect(bucketForDueDate('2026-11-24', '2026-11-16')).toBe('later')
  })
})
