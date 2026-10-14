import { describe, expect, it } from 'vitest'
import { defaultCalendarView } from '../../shared/utils/calendar'

describe('calendar default view', () => {
  it('opens the calendar in month view', () => {
    expect(defaultCalendarView).toBe('month')
  })
})
