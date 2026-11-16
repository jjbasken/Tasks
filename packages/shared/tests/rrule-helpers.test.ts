import { describe, it, expect, afterEach } from 'bun:test'
import { nextOccurrence, describeRrule, occurrencesBetween, nextOccurrenceDate, isSubDailyRule } from '../src/rrule-helpers.js'
import { placeTasks, nextDueOnCompletion } from '../src/calendar.js'

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

describe('sub-daily rules are evaluated per date', () => {
  // Each of these exhausted the old 10,000-iteration cap well before the range ended.
  for (const rrule of ['FREQ=MINUTELY', 'FREQ=SECONDLY', 'FREQ=SECONDLY;INTERVAL=1;BYHOUR=9']) {
    it(`${rrule} previews every date to the end of the range`, () => {
      const dates = occurrencesBetween(rrule, '2026-11-16', '2026-11-17', '2026-11-30')
      expect(dates).toHaveLength(14)
      expect(dates[0]).toBe('2026-11-17')
      expect(dates[13]).toBe('2026-11-30')
    })
  }
  it('keeps date filters such as BYDAY', () => {
    expect(occurrencesBetween('FREQ=MINUTELY;BYDAY=MO', '2026-11-16', '2026-11-17', '2026-11-30'))
      .toEqual(['2026-11-23', '2026-11-30'])
    expect(nextOccurrenceDate('FREQ=SECONDLY;BYDAY=MO', '2026-11-16')).toBe('2026-11-23')
  })
  it('keeps UNTIL', () => {
    expect(occurrencesBetween('FREQ=HOURLY;UNTIL=20261118T235959Z', '2026-11-16', '2026-11-17', '2026-11-30'))
      .toEqual(['2026-11-17', '2026-11-18'])
  })
  it('reports which rules are sub-daily', () => {
    expect(isSubDailyRule('FREQ=MINUTELY')).toBe(true)
    expect(isSubDailyRule('FREQ=DAILY')).toBe(false)
    expect(isSubDailyRule('NOPE')).toBe(false)
  })
})

describe('nextDueOnCompletion catch-up', () => {
  it('skips missed occurrences for an overdue task, keeping the rule rhythm', () => {
    expect(nextDueOnCompletion('FREQ=DAILY', '2026-11-14', '2026-11-16')).toBe('2026-11-17')
    // Due Monday Nov 2, completed Wednesday Nov 18: next Monday after today.
    expect(nextDueOnCompletion('FREQ=WEEKLY', '2026-11-02', '2026-11-18')).toBe('2026-11-23')
    // Every other week from Nov 2 lands on Nov 30, not Nov 23.
    expect(nextDueOnCompletion('FREQ=WEEKLY;INTERVAL=2', '2026-11-02', '2026-11-18')).toBe('2026-11-30')
  })
  it('uses the due date when completing early', () => {
    expect(nextDueOnCompletion('FREQ=WEEKLY', '2026-11-20', '2026-11-16')).toBe('2026-11-27')
  })
  it('anchors undated tasks at today', () => {
    expect(nextDueOnCompletion('FREQ=DAILY', null, '2026-11-16')).toBe('2026-11-17')
  })
})

describe('preview matches completion', () => {
  const originalTZ = process.env.TZ
  afterEach(() => { process.env.TZ = originalTZ })

  const rules = [
    'FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,TH', 'FREQ=WEEKLY;INTERVAL=2', 'FREQ=MONTHLY;BYMONTHDAY=1',
    'FREQ=HOURLY', 'FREQ=MINUTELY;BYDAY=MO,WE',
  ]
  // Not overdue, due today, overdue by 2 days, overdue by 3 weeks, and due in the future.
  const dues = ['2026-11-16', '2026-11-14', '2026-10-26', '2026-11-19']
  const today = '2026-11-16'

  for (const tz of ['Pacific/Auckland', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Honolulu', 'UTC']) {
    it(`first ghost equals the date completion creates in ${tz}`, () => {
      process.env.TZ = tz
      for (const rrule of rules) {
        for (const due of dues) {
          const next = nextDueOnCompletion(rrule, due, today)
          const { byDate } = placeTasks(
            [{ id: 't', status: 'active', due_date: due, completed_at: null, rrule }],
            '2026-10-01', '2027-01-31', today,
          )
          const firstGhost = [...byDate.entries()]
            .filter(([, ps]) => ps.some(p => p.kind === 'ghost'))
            .map(([d]) => d)
            .sort()[0]
          expect(`${rrule} due ${due}: ${firstGhost}`).toBe(`${rrule} due ${due}: ${next}`)
        }
      }
    })
  }
})
