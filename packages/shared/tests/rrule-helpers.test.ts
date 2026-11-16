import { describe, it, expect } from 'bun:test'
import { nextOccurrence, describeRrule, occurrencesBetween } from '../src/rrule-helpers.js'

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
