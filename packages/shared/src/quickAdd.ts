import { addDays, parseISODate, toLocalISODate } from './calendar.js'

export type QuickAddParse = { title: string; dueDate: string | null }

// Ambiguous abbreviations ("sun", "sat", "wed") are omitted so "Enjoy the sun" stays a title.
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6,
}

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?'
// Optional connector before the date ("Pay rent by fri"), dropped along with it.
const LEAD = '(?:^|\\s+)(?:(?:on|by|due)\\s+)?'

type Rule = { re: RegExp; resolve: (m: RegExpMatchArray, today: string) => string | null }

const rules: Rule[] = [
  { re: new RegExp(`${LEAD}(today|tonight)$`, 'i'), resolve: (_, today) => today },
  { re: new RegExp(`${LEAD}(tomorrow|tmrw|tmr)$`, 'i'), resolve: (_, today) => addDays(today, 1) },
  { re: new RegExp(`${LEAD}next\\s+week$`, 'i'), resolve: (_, today) => addDays(today, 7) },
  {
    re: new RegExp(`${LEAD}in\\s+(a|an|one|\\d{1,3})\\s+(days?|weeks?)$`, 'i'),
    resolve: (m, today) => {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1
      return addDays(today, m[2].toLowerCase().startsWith('week') ? n * 7 : n)
    },
  },
  {
    // "next fri" is ambiguous (this coming Friday or the one after), so it is left as text.
    re: new RegExp(`(?<!\\bnext)${LEAD}(${Object.keys(WEEKDAYS).join('|')})$`, 'i'),
    resolve: (m, today) => {
      const target = WEEKDAYS[m[1].toLowerCase()]
      const ahead = (target - parseISODate(today).getDay() + 7) % 7
      // A weekday means the next one after today; today is spelled "today".
      return addDays(today, ahead === 0 ? 7 : ahead)
    },
  },
  { re: new RegExp(`${LEAD}${MONTH}\\.?\\s+${DAY}$`, 'i'), resolve: (m, today) => monthDay(m[1], m[2], today) },
  { re: new RegExp(`${LEAD}${DAY}\\s+${MONTH}\\.?$`, 'i'), resolve: (m, today) => monthDay(m[2], m[1], today) },
]

/** The next occurrence of month/day on or after today, or null if it isn't a real date. */
function monthDay(monthName: string, dayStr: string, today: string): string | null {
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase())
  const day = Number(dayStr)
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    const d = new Date(y, month, day, 12)
    if (d.getMonth() !== month) return null // Feb 30 and friends
    const iso = toLocalISODate(d)
    if (iso >= today) return iso
  }
  return null
}

/**
 * Split a quick-add entry into a title and an optional due date taken from a trailing
 * phrase such as "tomorrow", "fri", "in 3 days" or "nov 30". Only the end of the text is
 * read, so dates mentioned mid-title stay put. If the date phrase is all there is, the
 * whole entry stays the title, so a task is never left without a title.
 */
export function parseQuickAdd(input: string, today: string): QuickAddParse {
  const text = input.trim().replace(/\s+/g, ' ')
  for (const { re, resolve } of rules) {
    const m = text.match(re)
    if (!m || m.index === undefined) continue
    const title = text.slice(0, m.index).trim()
    if (!title) break
    const dueDate = resolve(m, today)
    if (dueDate) return { title, dueDate }
  }
  return { title: text, dueDate: null }
}
