export const CREDIT_TOP_UP_MINIMUM = 500
export const CREDIT_TOP_UP_MAXIMUM = 1_000_000

export function isCreditTopUpQuantity(credits: number) {
  return Number.isSafeInteger(credits)
    && credits >= CREDIT_TOP_UP_MINIMUM
    && credits <= CREDIT_TOP_UP_MAXIMUM
}

/** Top-ups are sold at the single credit price stored in credit_pricing. */
export function creditTopUpPriceCents(credits: number, creditPriceCents: number) {
  if (!isCreditTopUpQuantity(credits))
    throw new Error(`credits must be an integer between ${CREDIT_TOP_UP_MINIMUM} and ${CREDIT_TOP_UP_MAXIMUM}`)
  if (!Number.isSafeInteger(creditPriceCents) || creditPriceCents <= 0)
    throw new Error('creditPriceCents must be a positive integer')
  return credits * creditPriceCents
}
