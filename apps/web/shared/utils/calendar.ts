import { months } from './format'

export type CalendarView = 'month' | 'week' | 'list'
export function dayInZone(value: Date | string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}
const dateOf = (key: string) => new Date(`${key}T12:00:00Z`)
const keyOf = (date: Date) => date.toISOString().slice(0, 10)
export function moveCalendar(anchor: string, view: CalendarView, direction: number): string {
  const date = dateOf(anchor)
  if (view === 'week') date.setUTCDate(date.getUTCDate() + direction * 7)
  else {
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + direction)
  }
  return keyOf(date)
}
export function calendarPeriod(anchor: string, view: CalendarView) {
  const date = dateOf(anchor)
  const month = date.getUTCMonth()
  const start = dateOf(anchor)
  if (view !== 'week') start.setUTCDate(1)
  const periodStart = keyOf(start)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  const days = Array.from({ length: view === 'week' ? 7 : 42 }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(day.getUTCDate() + index)
    return { key: keyOf(day), day: day.getUTCDate(), outside: day.getUTCMonth() !== month }
  })
  const last = dateOf(days[6]!.key)
  const title =
    view === 'week'
      ? `${start.getUTCDate()} ${months[start.getUTCMonth()]} – ${last.getUTCDate()} ${months[last.getUTCMonth()]} ${last.getUTCFullYear()}`
      : `${months[month]} ${date.getUTCFullYear()}`
  const end = dateOf(periodStart)
  end.setUTCMonth(end.getUTCMonth() + 1)
  end.setUTCDate(0)
  return {
    days,
    title,
    start: view === 'week' ? days[0]!.key : periodStart,
    end: view === 'week' ? days[6]!.key : keyOf(end),
  }
}
