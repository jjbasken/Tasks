import { describe, it, expect, afterEach } from 'bun:test'
import { nextOccurrence, describeRrule, occurrencesBetween, nextOccurrenceDate } from '../src/rrule-helpers.js'
import { placeTasks } from '../src/calendar.js'

describe('nextOccurrence', () => {
  it('returns the next weekly occurrence after the given date', () => {
    const rule = 'FREQ=WEEKLY;BYDAY=MO'
    // 2026-03-26 is a Thursday — next Monday is 2026-03-30
    const after = new Date('2026-03-26T00:00:00Z')
    const next = nextOccurrence(rule, after)
    expect(next?.toISOString().startsWith('2026-03-30')).toBe(true)
  })
  it('returns the next daily occurrence', () => {
    const rule = 'FREQ=DAILY'
    const after = new Date('2026-03-26T12:00:00Z')
    const next = nextOccurrence(rule, after)
    expect(next?.toISOString().startsWith('2026-03-27')).toBe(true)
  })
  it('returns null for an invalid rule', () => {
    expect(nextOccurrence('NOTARRULE', new Date())).toBeNull()
  })
})

describe('describeRrule', () => {
  it('describes a weekly rule', () => {
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,WE')).toMatch(/week/i)
  })
  it('returns null for invalid input', () => {
    expect(describeRrule('')).toBeNull()
  })
})

describe('occurrencesBetween', () => {
  it('lists weekly dates in range', () => {
    expect(occurrencesBetween('FREQ=WEEKLY;BYDAY=MO', '2026-11-16', '2026-11-17', '2026-12-07'))
      .toEqual(['2026-11-23', '2026-11-30', '2026-12-07'])
  })
  it('respects COUNT', () => {
    expect(occurrencesBetween('FREQ=DAILY;COUNT=3', '2026-11-16', '2026-11-01', '2026-11-30'))
      .toEqual(['2026-11-16', '2026-11-17', '2026-11-18'])
  })
  it('returns [] for an invalid rule', () => {
    expect(occurrencesBetween('NOPE', '2026-11-16', '2026-11-01', '2026-11-30')).toEqual([])
  })
})

describe('occurrencesBetween with sub-daily rules', () => {
  it('returns each date once for FREQ=HOURLY', () => {
    expect(occurrencesBetween('FREQ=HOURLY', '2026-11-16', '2026-11-16', '2026-11-18'))
      .toEqual(['2026-11-16', '2026-11-17', '2026-11-18'])
  })
  it('counts distinct dates toward the cap so later dates are not hidden', () => {
    const dates = occurrencesBetween('FREQ=HOURLY', '2026-11-01', '2026-11-01', '2026-11-30')
    expect(dates).toHaveLength(30)
    expect(dates[29]).toBe('2026-11-30')
  })
})

describe('nextOccurrenceDate', () => {
  it('returns the next date for daily and weekly rules', () => {
    expect(nextOccurrenceDate('FREQ=DAILY', '2026-11-16')).toBe('2026-11-17')
    expect(nextOccurrenceDate('FREQ=WEEKLY;BYDAY=MO', '2026-11-19')).toBe('2026-11-23')
  })
  it('advances sub-daily rules to the next day', () => {
    expect(nextOccurrenceDate('FREQ=HOURLY', '2026-11-16')).toBe('2026-11-17')
  })
  it('returns null for an invalid or exhausted rule', () => {
    expect(nextOccurrenceDate('NOPE', '2026-11-16')).toBeNull()
    expect(nextOccurrenceDate('FREQ=DAILY;COUNT=1', '2026-11-16')).toBeNull()
  })
})

describe('preview matches completion across timezones', () => {
  const originalTZ = process.env.TZ
  afterEach(() => { process.env.TZ = originalTZ })

  for (const tz of ['Pacific/Auckland', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Honolulu', 'UTC']) {
    it(`daily and weekly ghosts equal the completed next date in ${tz}`, () => {
      process.env.TZ = tz
      for (const rrule of ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,TH', 'FREQ=MONTHLY;BYMONTHDAY=1']) {
        const due = '2026-11-16'
        const next = nextOccurrenceDate(rrule, due)
        const { byDate } = placeTasks(
          [{ id: 't', status: 'active', due_date: due, completed_at: null, rrule }],
          '2026-11-15', '2026-12-31', due,
        )
        const firstGhost = [...byDate.entries()]
          .filter(([, ps]) => ps.some(p => p.kind === 'ghost'))
          .map(([d]) => d)
          .sort()[0]
        expect(firstGhost).toBe(next!)
      }
    })
  }
})
