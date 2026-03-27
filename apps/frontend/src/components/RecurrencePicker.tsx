import { useState } from 'react'
import { RRule } from 'rrule'

type Props = { value: string | null; onChange: (rrule: string | null) => void }

const PRESETS = [
  { label: 'None (one-time)', rule: null },
  { label: 'Daily', rule: 'FREQ=DAILY' },
  { label: 'Weekly', rule: 'FREQ=WEEKLY' },
  { label: 'Monthly', rule: 'FREQ=MONTHLY' },
  { label: 'Weekdays (Mon–Fri)', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every Mon & Wed', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
  { label: 'First Monday of month', rule: 'FREQ=MONTHLY;BYDAY=+1MO' },
  { label: 'Last weekday of month', rule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1' },
]

export function RecurrencePicker({ value, onChange }: Props) {
  const [custom, setCustom] = useState('')

  function applyCustom() {
    try {
      RRule.fromString(custom)
      onChange(custom)
    } catch {
      alert('Invalid RRULE string')
    }
  }

  return (
    <div>
      <label className="field-label">Recurrence</label>
      <div className="recur-options">
        {PRESETS.map(p => (
          <label key={p.rule ?? '__none'} className={`recur-option${value === p.rule ? ' selected' : ''}`}>
            <input className="recur-radio" type="radio" checked={value === p.rule} onChange={() => onChange(p.rule)} />
            {p.label}
          </label>
        ))}
        <div className="recur-custom-row">
          <input
            className="recur-custom-input"
            placeholder="Custom RRULE…"
            value={custom}
            onChange={e => setCustom(e.target.value)}
          />
          <button type="button" className="recur-apply-btn" onClick={applyCustom}>Apply</button>
        </div>
      </div>
    </div>
  )
}
