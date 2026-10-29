// Paddle refuses a checkout whose total is below its minimum charge for the
// currency ("Transaction balance is less than what we can charge"). Only the
// minimums Paddle has confirmed are listed; a currency missing here is not
// limited by this check.
export const paddleMinimumChargeCents: Partial<Record<string, number>> = {
  CHF: 60,
}

/** The minimum a paid offer must cost in this currency, or null when none is known. */
export function paddleMinimumCents(currency: string) {
  return paddleMinimumChargeCents[currency.toUpperCase()] ?? null
}

/** Whether a paid amount is too small for Paddle to charge. A zero price is a goodwill package, never charged. */
export function belowPaddleMinimum(cents: number, currency: string) {
  const minimum = paddleMinimumCents(currency)
  return minimum !== null && cents > 0 && cents < minimum
}
