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

// Recurrence on the calendar is date-only. Every date is mapped to UTC noon before it
// reaches rrule and read back with the UTC date, so the result never depends on the
// device's timezone. Previews and completion both go through these helpers so the
// ghost a user sees is the task that completing actually creates.

function utcNoon(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

function toUTCDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function anchoredRule(rruleStr: string, anchor: string): RRule {
  const rule = RRule.fromString(rruleStr)
  return new RRule({ ...rule.origOptions, dtstart: utcNoon(anchor) })
}

/**
 * The first occurrence date (YYYY-MM-DD) on a later calendar day than `after`, for a
 * rule anchored at `after`. Sub-daily rules (e.g. FREQ=HOURLY) advance to the next
 * day rather than repeating the same date. Returns null for an invalid or exhausted rule.
 */
export function nextOccurrenceDate(rruleStr: string, after: string): string | null {
  try {
    const rule = anchoredRule(rruleStr, after)
    // Start the search at the end of `after` so same-day occurrences are skipped.
    const next = rule.after(new Date(utcNoon(after).getTime() + 12 * 3600000 - 1), false)
    return next ? toUTCDate(next) : null
  } catch {
    return null
  }
}

/** Safety cap on raw rrule iterations, for very fine-grained rules like FREQ=MINUTELY. */
const MAX_ITERATIONS = 10_000

/**
 * Distinct occurrence dates (YYYY-MM-DD) of a rule anchored at `anchor`, between
 * `start` and `end` inclusive, at most `max` dates. Returns [] for an invalid rule.
 */
export function occurrencesBetween(rruleStr: string, anchor: string, start: string, end: string, max = 64): string[] {
  try {
    const rule = anchoredRule(rruleStr, anchor)
    const startD = new Date(utcNoon(start).getTime() - 12 * 3600000)
    const endD = new Date(utcNoon(end).getTime() + 12 * 3600000 - 1)
    const out: string[] = []
    let iterations = 0
    rule.between(startD, endD, true, (date) => {
      const iso = toUTCDate(date)
      if (out[out.length - 1] !== iso) out.push(iso)
      return out.length < max && ++iterations < MAX_ITERATIONS
    })
    return out
  } catch {
    return []
  }
}
