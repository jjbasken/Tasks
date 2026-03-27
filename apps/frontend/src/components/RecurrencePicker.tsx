import { useState } from 'react'
import { RRule } from 'rrule'

type Props = { value: string | null; onChange: (rrule: string | null) => void }

const PRESETS = [
  { label: 'Daily', rule: 'FREQ=DAILY' },
  { label: 'Weekly', rule: 'FREQ=WEEKLY' },
  { label: 'Monthly', rule: 'FREQ=MONTHLY' },
  { label: 'Weekdays (Mon–Fri)', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every Monday & Wednesday', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
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
      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 8 }}>Recurrence</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label><input type="radio" checked={value === null} onChange={() => onChange(null)} /> None (one-time)</label>
        {PRESETS.map(p => (
          <label key={p.rule}><input type="radio" checked={value === p.rule} onChange={() => onChange(p.rule)} /> {p.label}</label>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input placeholder="Custom RRULE…" value={custom} onChange={e => setCustom(e.target.value)} style={{ flex: 1 }} />
          <button type="button" onClick={applyCustom}>Apply</button>
        </div>
      </div>
    </div>
  )
}
