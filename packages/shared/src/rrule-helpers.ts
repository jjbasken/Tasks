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

/** Most occurrences walked to find where a counted rule ends. */
const MAX_COUNT_WALK = 10_000

type Opts = Partial<typeof RRule.prototype.origOptions>

type DateRule = {
  rule: RRule
  /** The rule has no occurrences after its anchor date. */
  empty: boolean
  /** False when the rule can't be expressed per date without changing when it stops. */
  previewable: boolean
}

const ruleCache = new Map<string, DateRule>()

function stepMs(opts: Opts): number {
  return (opts.interval ?? 1) * UNIT_MS[opts.freq as number]
}

function hasFilters(opts: Opts): boolean {
  return [opts.byhour, opts.byminute, opts.bysecond, opts.byweekday, opts.bymonth,
    opts.bymonthday, opts.byyearday, opts.byweekno, opts.bysetpos, opts.byeaster]
    .some(v => v != null && !(Array.isArray(v) && v.length === 0))
}

function endOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59))
}

function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * The last occurrence of a rule with COUNT (and any UNTIL), null when it has none, or
 * undefined when finding it would mean walking more than MAX_COUNT_WALK occurrences.
 */
function lastCountedOccurrence(opts: Opts): Date | null | undefined {
  const count = opts.count as number
  if (count <= 0) return null
  const dt = opts.dtstart!
  if (SUB_DAILY.has(opts.freq as number) && !hasFilters(opts)) {
    // Evenly spaced: the (count - 1)th step, or the last step at or before UNTIL.
    const step = stepMs(opts)
    let steps = count - 1
    if (opts.until) steps = Math.min(steps, Math.floor((opts.until.getTime() - dt.getTime()) / step))
    return steps < 0 ? null : new Date(dt.getTime() + steps * step)
  }
  if (count > MAX_COUNT_WALK) return undefined
  const all = new RRule(opts).all()
  return all.length ? all[all.length - 1] : null
}

/**
 * Whether a sub-daily rule (ignoring COUNT) has an occurrence in [from, to]. Iteration
 * starts at the rule's own step boundary just before `from`, so it covers at most the
 * span between the two and keeps the original interval alignment.
 */
function hasSubDailyOccurrence(opts: Opts, from: Date, to: Date): boolean {
  const dt = opts.dtstart!
  const lo = from < dt ? dt : from
  if (to < lo) return false
  const step = stepMs(opts)
  const start = new Date(dt.getTime() + Math.floor((lo.getTime() - dt.getTime()) / step) * step)
  const scan: Opts = { ...opts, dtstart: start, until: to }
  delete scan.count
  return new RRule(scan).after(lo, true) != null
}

/**
 * Tasks carry a date but no time, so a rule that repeats within a day is treated as
 * repeating on every day it matches: it becomes FREQ=DAILY with its date filters
 * (BYDAY, BYMONTH, BYMONTHDAY, BYYEARDAY, BYWEEKNO) kept. Time-of-day parts (BYHOUR,
 * BYMINUTE, BYSECOND), INTERVAL and BYSETPOS describe positions within the day and are
 * dropped, so work scales with days rather than seconds.
 *
 * The end condition is preserved exactly:
 * - COUNT becomes the date of the rule's actual last occurrence from the anchor. With
 *   no occurrences at all, the converted rule is empty.
 * - UNTIL keeps its own date only when the original rule has an occurrence on that date
 *   at or before the cutoff; otherwise it ends the day before.
 * A filtered rule whose COUNT is too large to walk keeps its original, unconverted form
 * so it still stops exactly where it did, and gets no calendar previews.
 */
function anchoredRule(rruleStr: string, anchor: string): DateRule {
  const key = `${anchor}|${rruleStr}`
  const cached = ruleCache.get(key)
  if (cached) return cached

  const opts: Opts = { ...RRule.fromString(rruleStr).origOptions, dtstart: utcNoon(anchor) }
  let result: DateRule = { rule: new RRule(opts), empty: false, previewable: true }

  if (SUB_DAILY.has(opts.freq as number)) {
    let lastDate: Date | null | undefined = null // undefined: unknown; null: open-ended
    let empty = false
    if (opts.count != null) {
      const last = lastCountedOccurrence(opts)
      if (last === undefined) lastDate = undefined
      else if (last === null) empty = true
      else lastDate = last
    } else if (opts.until) {
      const until = opts.until
      lastDate = hasSubDailyOccurrence(opts, startOfUTCDay(until), until)
        ? until
        : new Date(startOfUTCDay(until).getTime() - 1000)
    }

    if (lastDate === undefined) {
      result = { rule: result.rule, empty: false, previewable: false }
    } else {
      const daily: Opts = { ...opts, freq: RRule.DAILY }
      delete daily.interval
      delete daily.count
      delete daily.until
      delete daily.byhour
      delete daily.byminute
      delete daily.bysecond
      delete daily.bysetpos
      // Close UNTIL at the end of its UTC day so that date's noon occurrence is kept.
      if (lastDate) daily.until = endOfUTCDay(lastDate)
      result = { rule: new RRule(daily), empty, previewable: true }
    }
  }

  if (ruleCache.size > 500) ruleCache.clear()
  ruleCache.set(key, result)
  return result
}

/**
 * The rule to save on the occurrence created by completing a task due `anchor`.
 *
 * Each occurrence anchors the rule at its own due date, so a COUNT copied unchanged
 * would restart on every successor and the series would never end. Instead COUNT is
 * replaced by an UNTIL at the series' actual last occurrence, computed from this
 * anchor, and that end carries forward unchanged. Rules without COUNT, and counts too
 * large to walk, are returned as is.
 */
export function successorRule(rruleStr: string, anchor: string): string {
  try {
    const orig = RRule.fromString(rruleStr).origOptions
    if (orig.count == null) return rruleStr
    const last = lastCountedOccurrence({ ...orig, dtstart: utcNoon(anchor) })
    if (!last) return rruleStr
    const next: Opts = { ...orig, until: last }
    delete next.count
    delete next.dtstart
    return RRule.optionsToString(next).replace(/^RRULE:/, '')
  } catch {
    return rruleStr
  }
}

/**
 * The first occurrence date (YYYY-MM-DD) after the calendar day `after`, for a rule
 * anchored at `anchor` (the task's due date). `after` defaults to the anchor; pass a
 * later date (today) to skip missed occurrences while keeping the rule's rhythm.
 * Returns null for an invalid or exhausted rule.
 */
export function nextOccurrenceDate(rruleStr: string, anchor: string, after: string = anchor): string | null {
  try {
    const { rule, empty } = anchoredRule(rruleStr, anchor)
    if (empty) return null
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
    const { rule, empty, previewable } = anchoredRule(rruleStr, anchor)
    if (empty || !previewable) return []
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
