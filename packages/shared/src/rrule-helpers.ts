import { RRule } from 'rrule'

/**
 * Given an RRULE string and a reference date, return the next occurrence after that date.
 * Returns null if the rule is invalid or has no future occurrences.
 */
export function nextOccurrence(rruleStr: string, after: Date): Date | null {
  try {
    const rule = RRule.fromString(rruleStr)
    return rule.after(after, false)
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
