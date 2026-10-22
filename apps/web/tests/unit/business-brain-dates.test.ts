import { describe, expect, it } from 'vitest'
import { dateValue } from '../../server/utils/business-brain'

describe('reading a date column', () => {
  it('keeps the calendar day pg read, whatever the server time zone', () => {
    // pg returns a date column as local midnight of that day.
    expect(dateValue(new Date(2026, 8, 28))).toBe('2026-09-28')
    expect(dateValue(new Date(2026, 11, 31))).toBe('2026-12-31')
    expect(dateValue(new Date(2027, 0, 1))).toBe('2027-01-01')
  })

  it('leaves a date already read as text as it is', () => {
    expect(dateValue('2026-09-28')).toBe('2026-09-28')
  })
})
