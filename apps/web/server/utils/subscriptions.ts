/** Annual price = monthly price x 12 x (1 - discount), rounded to the cent. */
export function annualPriceCents(monthlyCents: number, discountPercent: number) {
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 0)
    throw new Error('monthlyCents must be a non-negative integer')
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100)
    throw new Error('discountPercent must be between 0 and 100')
  return Math.round((monthlyCents * 12 * (100 - discountPercent)) / 100)
}

/** Adds calendar months in UTC, clamping to the last day of shorter months. */
export function addMonths(date: Date, months: number) {
  const day = date.getUTCDate()
  const result = new Date(date)
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}
