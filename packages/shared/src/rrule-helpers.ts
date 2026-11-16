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

const SUB_DAILY = new Set([RRule.HOURLY, RRule.MINUTELY, RRule.SECONDLY])

/** True for rules that repeat more often than daily (FREQ=HOURLY, MINUTELY, SECONDLY). */
export function isSubDailyRule(rruleStr: string): boolean {
  try {
    return SUB_DAILY.has(RRule.fromString(rruleStr).origOptions.freq as number)
  } catch {
    return false
  }
}

const UNIT_MS: Record<number, number> = { [RRule.HOURLY]: 3600000, [RRule.MINUTELY]: 60000, [RRule.SECONDLY]: 1000 }

/** Most occurrences walked to find where a filtered, counted sub-daily rule ends. */
const MAX_COUNT_WALK = 10_000

type DateRule = {
  rule: RRule
  /** False when the rule can't be expressed per date without changing when it stops. */
  previewable: boolean
}

const ruleCache = new Map<string, DateRule>()

/**
 * Tasks carry a date but no time, so a rule that repeats within a day is treated as
 * repeating on every day it matches: it becomes FREQ=DAILY with its date filters
 * (BYDAY, BYMONTH, BYMONTHDAY, BYYEARDAY, BYWEEKNO) and UNTIL kept. Time-of-day parts
 * (BYHOUR, BYMINUTE, BYSECOND), INTERVAL and BYSETPOS describe positions within the
 * day and are dropped, so work scales with days rather than seconds.
 *
 * COUNT is an end condition, so it is kept by converting it to an UNTIL on the date of
 * the rule's last occurrence from the anchor. `FREQ=HOURLY;COUNT=1` therefore still
 * ends after its first date. Without filters that date is computed directly. With
 * filters the occurrences are walked; if more than MAX_COUNT_WALK remain, the rule
 * keeps its original, unconverted form so it still stops exactly where it did, and
 * gets no calendar previews.
 */
function anchoredRule(rruleStr: string, anchor: string): DateRule {
  const key = `${anchor}|${rruleStr}`
  const cached = ruleCache.get(key)
  if (cached) return cached

  const opts = { ...RRule.fromString(rruleStr).origOptions, dtstart: utcNoon(anchor) }
  let result: DateRule = { rule: new RRule(opts), previewable: true }

  if (SUB_DAILY.has(opts.freq as number)) {
    let until = opts.until ?? null
    let convertible = true
    if (opts.count != null) {
      const last = lastCountedOccurrence(opts)
      if (last === undefined) convertible = false
      else if (last && (!until || last < until)) until = last
    }
    if (convertible) {
      const daily = { ...opts, freq: RRule.DAILY }
      delete daily.interval
      delete daily.count
      delete daily.byhour
      delete daily.byminute
      delete daily.bysecond
      delete daily.bysetpos
      // Close UNTIL at the end of its UTC day so that date's noon occurrence is kept.
      if (until) daily.until = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate(), 23, 59, 59))
      result = { rule: new RRule(daily), previewable: true }
    } else {
      result = { rule: result.rule, previewable: false }
    }
  }

  if (ruleCache.size > 500) ruleCache.clear()
  ruleCache.set(key, result)
  return result
}

/**
 * The time of the last occurrence of a counted sub-daily rule, null if it has none,
 * or undefined when finding it would mean walking more than MAX_COUNT_WALK occurrences.
 */
function lastCountedOccurrence(opts: Partial<typeof RRule.prototype.origOptions>): Date | null | undefined {
  const count = opts.count as number
  if (count <= 0) return null
  const filtered = [opts.byhour, opts.byminute, opts.bysecond, opts.byweekday, opts.bymonth,
    opts.bymonthday, opts.byyearday, opts.byweekno, opts.bysetpos, opts.byeaster]
    .some(v => v != null && !(Array.isArray(v) && v.length === 0))
  if (!filtered) {
    // Evenly spaced: dtstart + (count - 1) steps.
    const step = (opts.interval ?? 1) * UNIT_MS[opts.freq as number]
    const last = new Date(opts.dtstart!.getTime() + (count - 1) * step)
    return opts.until && last > opts.until ? opts.until : last
  }
  if (count > MAX_COUNT_WALK) return undefined
  const all = new RRule(opts).all()
  return all.length ? all[all.length - 1] : null
}

/**
 * The first occurrence date (YYYY-MM-DD) after the calendar day `after`, for a rule
 * anchored at `anchor` (the task's due date). `after` defaults to the anchor; pass a
 * later date (today) to skip missed occurrences while keeping the rule's rhythm.
 * Returns null for an invalid or exhausted rule.
 */
export function nextOccurrenceDate(rruleStr: string, anchor: string, after: string = anchor): string | null {
  try {
    const { rule } = anchoredRule(rruleStr, anchor)
    // Start the search at the end of `after` so same-day occurrences are skipped.
    const next = rule.after(new Date(utcNoon(after).getTime() + 12 * 3600000 - 1), false)
    return next ? toUTCDate(next) : null
  } catch {
    return null
  }
}

/**
 * Distinct occurrence dates (YYYY-MM-DD) of a rule anchored at `anchor`, between
 * `start` and `end` inclusive, at most `max` dates. Returns [] for an invalid rule.
 */
export function occurrencesBetween(rruleStr: string, anchor: string, start: string, end: string, max = 64): string[] {
  try {
    const { rule, previewable } = anchoredRule(rruleStr, anchor)
    if (!previewable) return []
    const startD = new Date(utcNoon(start).getTime() - 12 * 3600000)
    const endD = new Date(utcNoon(end).getTime() + 12 * 3600000 - 1)
    const out: string[] = []
    rule.between(startD, endD, true, (date) => {
      const iso = toUTCDate(date)
      if (out[out.length - 1] !== iso) out.push(iso)
      return out.length < max
    })
    return out
  } catch {
    return []
  }
}
