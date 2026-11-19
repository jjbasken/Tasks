import { describe, it, expect } from 'bun:test'
import { parseQuickAdd } from '../src/quickAdd.js'

// 2026-11-18 is a Wednesday.
const today = '2026-11-18'
const p = (s: string) => parseQuickAdd(s, today)

describe('parseQuickAdd', () => {
  it('keeps plain titles as-is, collapsing whitespace', () => {
    expect(p('  Buy   milk ')).toEqual({ title: 'Buy milk', dueDate: null })
  })
  it('reads today and tomorrow', () => {
    expect(p('Call mom today')).toEqual({ title: 'Call mom', dueDate: '2026-11-18' })
    expect(p('Call mom tonight')).toEqual({ title: 'Call mom', dueDate: '2026-11-18' })
    expect(p('Pay rent Tomorrow')).toEqual({ title: 'Pay rent', dueDate: '2026-11-19' })
    expect(p('Pay rent tmrw')).toEqual({ title: 'Pay rent', dueDate: '2026-11-19' })
  })
  it('reads weekdays as the next one after today', () => {
    expect(p('Gym fri')).toEqual({ title: 'Gym', dueDate: '2026-11-20' })
    expect(p('Gym monday')).toEqual({ title: 'Gym', dueDate: '2026-11-23' })
    expect(p('Gym wednesday')).toEqual({ title: 'Gym', dueDate: '2026-11-25' })
    expect(p('Gym sunday')).toEqual({ title: 'Gym', dueDate: '2026-11-22' })
  })
  it('drops a connector word before the date', () => {
    expect(p('Submit report by fri')).toEqual({ title: 'Submit report', dueDate: '2026-11-20' })
    expect(p('Dentist on thursday')).toEqual({ title: 'Dentist', dueDate: '2026-11-19' })
    expect(p('Taxes due dec 1')).toEqual({ title: 'Taxes', dueDate: '2026-12-01' })
  })
  it('reads relative offsets', () => {
    expect(p('Follow up in 3 days')).toEqual({ title: 'Follow up', dueDate: '2026-11-21' })
    expect(p('Follow up in 2 weeks')).toEqual({ title: 'Follow up', dueDate: '2026-12-02' })
    expect(p('Follow up in a week')).toEqual({ title: 'Follow up', dueDate: '2026-11-25' })
    expect(p('Review next week')).toEqual({ title: 'Review', dueDate: '2026-11-25' })
  })
  it('reads month and day in either order, rolling into next year when past', () => {
    expect(p('Party nov 30')).toEqual({ title: 'Party', dueDate: '2026-11-30' })
    expect(p('Party 30 Nov')).toEqual({ title: 'Party', dueDate: '2026-11-30' })
    expect(p('Party December 3rd')).toEqual({ title: 'Party', dueDate: '2026-12-03' })
    expect(p('Party nov 18')).toEqual({ title: 'Party', dueDate: '2026-11-18' })
    expect(p('Renew passport mar 2')).toEqual({ title: 'Renew passport', dueDate: '2027-03-02' })
  })
  it('leaves impossible dates in the title', () => {
    expect(p('Party feb 30')).toEqual({ title: 'Party feb 30', dueDate: null })
  })
  it('never strips the whole entry', () => {
    expect(p('tomorrow')).toEqual({ title: 'tomorrow', dueDate: null })
    expect(p('by friday')).toEqual({ title: 'by friday', dueDate: null })
  })
  it('ignores dates that are not at the end, or are ambiguous words', () => {
    expect(p('Plan friday dinner')).toEqual({ title: 'Plan friday dinner', dueDate: null })
    expect(p('Enjoy the sun')).toEqual({ title: 'Enjoy the sun', dueDate: null })
    expect(p('Ask if I may')).toEqual({ title: 'Ask if I may', dueDate: null })
    expect(p('Sunday')).toEqual({ title: 'Sunday', dueDate: null })
    expect(p('Holiday party next fri')).toEqual({ title: 'Holiday party next fri', dueDate: null })
    expect(p('Fix theday')).toEqual({ title: 'Fix theday', dueDate: null })
  })
})
