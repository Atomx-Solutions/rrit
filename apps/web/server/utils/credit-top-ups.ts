export const CREDIT_TOP_UP_MINIMUM = 500
export const CREDIT_TOP_UP_MAXIMUM = 1_000_000
export const CREDIT_TOP_UP_UNIT_PRICE_CENTS = 2

export function isCreditTopUpQuantity(credits: number) {
  return Number.isSafeInteger(credits)
    && credits >= CREDIT_TOP_UP_MINIMUM
    && credits <= CREDIT_TOP_UP_MAXIMUM
}

export function creditTopUpPriceCents(credits: number) {
  if (!isCreditTopUpQuantity(credits))
    throw new Error(`credits must be an integer between ${CREDIT_TOP_UP_MINIMUM} and ${CREDIT_TOP_UP_MAXIMUM}`)
  return credits * CREDIT_TOP_UP_UNIT_PRICE_CENTS
}
