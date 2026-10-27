import { creditsForProviderCost } from './credits'

// The figures a video's cost in credits is worked out from: the model's
// published price per second, the configured USD rate (AI_USD_MICRO_EUR) and
// what one credit pays for (credit_pricing).
export type VideoPricing = {
  pricePerSecondUsd: number
  usdMicroEur: number
  providerCostPerCreditMicroEur: number
}

export function usdMicroEurRate() {
  const value = Number(process.env.AI_USD_MICRO_EUR)
  return Number.isFinite(value) && value > 0 ? value : null
}

// One second in whole micro-EUR, so the sums below stay exact instead of
// carrying the rounding error of a decimal dollar price.
function secondMicroEur(pricing: VideoPricing) {
  return Math.max(1, Math.round(pricing.pricePerSecondUsd * pricing.usdMicroEur))
}

/** How many seconds of video the given credits pay for. */
export function affordableVideoSeconds(credits: number, pricing: VideoPricing) {
  return Math.floor((credits * pricing.providerCostPerCreditMicroEur) / secondMicroEur(pricing))
}

/** The credits a video of this many seconds is expected to cost. */
export function estimatedVideoCredits(seconds: number, pricing: VideoPricing) {
  return creditsForProviderCost(seconds * secondMicroEur(pricing), pricing.providerCostPerCreditMicroEur)
}
