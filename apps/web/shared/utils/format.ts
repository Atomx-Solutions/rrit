// Explicit Albanian labels also work in Chromium builds without sq ICU data.
export const months = [
  'janar',
  'shkurt',
  'mars',
  'prill',
  'maj',
  'qershor',
  'korrik',
  'gusht',
  'shtator',
  'tetor',
  'nëntor',
  'dhjetor',
]
export const formatNumber = (value: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)
// Admin and platform prices use EUR as the canonical currency. Customer-facing
// views pass the workspace currency explicitly when they need CHF.
export const formatMoney = (value: number, currency = 'EUR') =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    // Whole amounts stay compact (19 €); any cents always show two digits (254,90 €).
    minimumFractionDigits: Number.isInteger(Math.round(value * 100) / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
export const formatDate = (
  value: string,
  timezone = 'Europe/Tirane',
  short = false,
  locale = 'sq',
) => {
  const date = new Date(value)
  if (locale.startsWith('en')) {
    const dateLabel = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: timezone,
    }).format(date)
    if (short) return dateLabel
    const timeLabel = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(date)
    return `${dateLabel} · ${timeLabel}`
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  return `${p.day} ${months[Number(p.month) - 1]!.slice(0, 3)}${short ? '' : ` · ${p.hour}:${p.minute}`}`
}
export const statusLabels = {
  draft: 'Draft',
  review: 'Për miratim',
  approved: 'Miratuar',
  scheduled: 'Planifikuar',
  published: 'Publikuar',
  failed: 'Dështuar',
} as const
export function safeRedirect(value: unknown, fallback = '/app') {
  return typeof value === 'string' &&
    /^\/(?!\/)/.test(value) &&
    !/[\\\r\n]/.test(value) &&
    !value.includes('%')
    ? value
    : fallback
}
// Interpret a wall-clock input in an explicit IANA zone, never the browser's zone.
export function zonedToIso(local: string, zone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!match) return null
  const values = match.slice(1).map(Number)
  const target = Date.UTC(values[0]!, values[1]! - 1, values[2]!, values[3]!, values[4]!)
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  let guess = target
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]))
    const actual = Date.UTC(
      +parts.year!,
      +parts.month! - 1,
      +parts.day!,
      +parts.hour!,
      +parts.minute!,
    )
    guess += target - actual
  }
  if (fmt.format(guess).replace(' ', 'T') !== local) return null
  // Reject ambiguous repeated wall times; user must choose another time.
  if ([-3600000, 3600000].some((delta) => fmt.format(guess + delta).replace(' ', 'T') === local))
    return null
  return new Date(guess).toISOString()
}
