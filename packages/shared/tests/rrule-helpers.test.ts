import { describe, it, expect, afterEach } from 'bun:test'
import { nextOccurrence, describeRrule, occurrencesBetween, nextOccurrenceDate, isSubDailyRule, successorRule } from '../src/rrule-helpers.js'
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

describe('sub-daily rules keep their end condition', () => {
  it('FREQ=HOURLY;COUNT=1 creates no successor and no previews', () => {
    const rrule = 'FREQ=HOURLY;COUNT=1'
    expect(nextOccurrenceDate(rrule, '2026-11-16')).toBeNull()
    expect(nextDueOnCompletion(rrule, '2026-11-16', '2026-11-16')).toBeNull()
    expect(occurrencesBetween(rrule, '2026-11-16', '2026-11-17', '2026-11-30')).toEqual([])
    const { byDate } = placeTasks(
      [{ id: 't', status: 'active', due_date: '2026-11-16', completed_at: null, rrule }],
      '2026-11-15', '2026-11-30', '2026-11-16',
    )
    expect([...byDate.values()].flat().map(p => p.kind)).toEqual(['active'])
  })
  it('converts an unfiltered COUNT to the date of its last occurrence', () => {
    // 24 hourly occurrences from noon end at 11:00 the next day.
    expect(occurrencesBetween('FREQ=HOURLY;COUNT=24', '2026-11-16', '2026-11-16', '2026-11-30'))
      .toEqual(['2026-11-16', '2026-11-17'])
    expect(nextOccurrenceDate('FREQ=HOURLY;COUNT=24', '2026-11-16')).toBe('2026-11-17')
    expect(nextOccurrenceDate('FREQ=HOURLY;COUNT=24', '2026-11-16', '2026-11-17')).toBeNull()
    // 3000 minutes from noon end on Nov 18; INTERVAL scales the span.
    expect(occurrencesBetween('FREQ=MINUTELY;COUNT=3000', '2026-11-16', '2026-11-17', '2026-11-30'))
      .toEqual(['2026-11-17', '2026-11-18'])
    expect(occurrencesBetween('FREQ=HOURLY;INTERVAL=24;COUNT=3', '2026-11-16', '2026-11-17', '2026-11-30'))
      .toEqual(['2026-11-17', '2026-11-18'])
  })
  it('walks a filtered COUNT to find where it ends', () => {
    // Three 9:00 occurrences after a noon anchor: Nov 17, 18, 19. The anchor date is the
    // task itself, so it is always in the set (ghosts start after it).
    expect(occurrencesBetween('FREQ=HOURLY;BYHOUR=9;COUNT=3', '2026-11-16', '2026-11-16', '2026-11-30'))
      .toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'])
    expect(nextOccurrenceDate('FREQ=HOURLY;BYHOUR=9;COUNT=3', '2026-11-16', '2026-11-19')).toBeNull()
  })
  it('the earlier of COUNT and UNTIL wins', () => {
    expect(occurrencesBetween('FREQ=HOURLY;COUNT=100;UNTIL=20261117T235959Z', '2026-11-16', '2026-11-16', '2026-11-30'))
      .toEqual(['2026-11-16', '2026-11-17'])
  })
  it('keeps a filtered rule with a very large COUNT unconverted, without previews', () => {
    const rrule = 'FREQ=SECONDLY;BYHOUR=9;COUNT=20000'
    expect(occurrencesBetween(rrule, '2026-11-16', '2026-11-17', '2026-11-30')).toEqual([])
    expect(nextOccurrenceDate(rrule, '2026-11-16')).toBe('2026-11-17')
  })
})

/**
 * Complete a recurring task and each successor it creates on its due date, the way
 * TasksPage.handleToggle does, and return every due date in the series.
 */
function completeSeries(rrule: string, due: string, limit = 40): { dues: string[]; rules: string[] } {
  const dues = [due]
  const rules = [rrule]
  for (let i = 0; i < limit; i++) {
    const next = nextDueOnCompletion(rrule, due, due)
    if (!next) break
    rrule = successorRule(rrule, due)
    due = next
    dues.push(due)
    rules.push(rrule)
  }
  return { dues, rules }
}

function previewDates(rrule: string, due: string): string[] {
  const { byDate } = placeTasks(
    [{ id: 't', status: 'active', due_date: due, completed_at: null, rrule }],
    due, '2027-03-31', due,
  )
  return [...byDate.entries()].filter(([, ps]) => ps.some(p => p.kind === 'ghost')).map(([d]) => d).sort()
}

describe('successive completions honor the series end', () => {
  const cases: [string, string[]][] = [
    ['FREQ=HOURLY;COUNT=1', ['2026-11-16']],
    ['FREQ=HOURLY;COUNT=24', ['2026-11-16', '2026-11-17']],
    ['FREQ=MINUTELY;COUNT=3000', ['2026-11-16', '2026-11-17', '2026-11-18']],
    ['FREQ=HOURLY;BYHOUR=9;COUNT=3', ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']],
    ['FREQ=DAILY;COUNT=3', ['2026-11-16', '2026-11-17', '2026-11-18']],
    ['FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4', ['2026-11-16', '2026-11-19', '2026-11-23', '2026-11-26']],
    ['FREQ=HOURLY;BYHOUR=9;COUNT=1;UNTIL=20261117T085959Z', ['2026-11-16']],
    ['FREQ=HOURLY;BYHOUR=9;UNTIL=20261117T085959Z', ['2026-11-16']],
    ['FREQ=HOURLY;BYHOUR=9;UNTIL=20261117T090000Z', ['2026-11-16', '2026-11-17']],
    // Intervals that don't divide a day: re-anchoring each successor must not drop the end.
    ['FREQ=HOURLY;INTERVAL=23;COUNT=3', ['2026-11-16', '2026-11-17', '2026-11-18']],
    ['FREQ=HOURLY;INTERVAL=23;UNTIL=20261118T100000Z', ['2026-11-16', '2026-11-17', '2026-11-18']],
    ['FREQ=HOURLY;INTERVAL=48;COUNT=2', ['2026-11-16', '2026-11-17', '2026-11-18']],
    ['FREQ=MINUTELY;INTERVAL=1439;COUNT=4', ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']],
    ['FREQ=WEEKLY;INTERVAL=2;COUNT=3', ['2026-11-16', '2026-11-30', '2026-12-14']],
  ]
  for (const [rrule, expected] of cases) {
    it(`${rrule} ends after ${expected.length} task(s), matching the first preview`, () => {
      const { dues } = completeSeries(rrule, '2026-11-16')
      expect(dues).toEqual(expected)
      expect(previewDates(rrule, '2026-11-16')).toEqual(expected.slice(1))
    })
  }

  it('saves the computed end on the successor instead of restarting COUNT', () => {
    // Sub-daily rules save their date-only form, ending at the end of the last date.
    expect(successorRule('FREQ=HOURLY;COUNT=24', '2026-11-16')).toBe('FREQ=DAILY;UNTIL=20261117T235959Z')
    expect(successorRule('FREQ=HOURLY;INTERVAL=23;COUNT=3', '2026-11-16')).toBe('FREQ=DAILY;UNTIL=20261118T235959Z')
    expect(successorRule('FREQ=MINUTELY;BYDAY=MO', '2026-11-16')).toBe('FREQ=DAILY;BYDAY=MO')
    expect(successorRule('FREQ=DAILY;COUNT=3', '2026-11-16')).toBe('FREQ=DAILY;UNTIL=20261118T120000Z')
    const { rules } = completeSeries('FREQ=DAILY;COUNT=3', '2026-11-16')
    expect(rules.slice(1)).toEqual(['FREQ=DAILY;UNTIL=20261118T120000Z', 'FREQ=DAILY;UNTIL=20261118T120000Z'])
  })
  it('leaves rules without COUNT, and counts too large to walk, unchanged', () => {
    expect(successorRule('FREQ=WEEKLY;BYDAY=MO', '2026-11-16')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(successorRule('FREQ=SECONDLY;BYHOUR=9;COUNT=20000', '2026-11-16')).toBe('FREQ=SECONDLY;BYHOUR=9;COUNT=20000')
    expect(successorRule('NOPE', '2026-11-16')).toBe('NOPE')
  })
  it('an overdue task whose series already ended creates no successor', () => {
    expect(nextDueOnCompletion('FREQ=DAILY;COUNT=3', '2026-11-10', '2026-11-16')).toBeNull()
    expect(nextDueOnCompletion('FREQ=HOURLY;COUNT=24', '2026-11-10', '2026-11-16')).toBeNull()
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
