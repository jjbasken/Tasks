import { RRule } from 'rrule'

/**
 * Given an RRULE string and a reference date, return the next occurrence after that date.
 * Returns null if the rule is invalid or has no future occurrences.
 */
export function nextOccurrence(rruleStr: string, after: Date): Date | null {
  try {
    const rule = RRule.fromString(rruleStr)
    // Anchor DTSTART to `after` so occurrences are relative to the task's due date,
    // not the date the rule was originally created.
    const anchored = new RRule({ ...rule.origOptions, dtstart: after })
    return anchored.after(after, false)
  } catch {
    return null
  }
}

/**
 * Return a human-readable description of an RRULE string (e.g. "every week on Monday").
 * Returns null for empty or invalid input.
 */
export function describeRrule(rruleStr: string): string | null {
  if (!rruleStr) return null
  try {
    const rule = RRule.fromString(rruleStr)
    return rule.toText()
  } catch {
    return null
  }
}

/**
 * Occurrence dates (YYYY-MM-DD) of a rule anchored at `anchor`, between `start` and
 * `end` inclusive. Dates are computed in UTC at noon so the calendar day is stable.
 * Returns [] for an invalid rule. Capped to avoid runaway expansion.
 */
export function occurrencesBetween(rruleStr: string, anchor: string, start: string, end: string, max = 64): string[] {
  try {
    const utcNoon = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, d, 12))
    }
    const rule = RRule.fromString(rruleStr)
    const anchored = new RRule({ ...rule.origOptions, dtstart: utcNoon(anchor) })
    const startD = new Date(utcNoon(start).getTime() - 12 * 3600000)
    const endD = new Date(utcNoon(end).getTime() + 12 * 3600000 - 1)
    const out: string[] = []
    anchored.between(startD, endD, true, (date) => {
      out.push(date.toISOString().slice(0, 10))
      return out.length < max
    })
    return out
  } catch {
    return []
  }
}
