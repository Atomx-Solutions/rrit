export type LowCreditAction = 'request-package' | 'request-credits'

/**
 * The reminder shows below the threshold unless the customer dismissed it in
 * this session; a dismissal lasts only while the balance stays at or above
 * the balance it was dismissed at.
 */
export function showLowCreditReminder(credits: number, threshold: number, dismissedAt: number | null) {
  if (credits >= threshold) return false
  return dismissedAt === null || credits < dismissedAt
}

/**
 * Without a package in force there is nothing to top up, so the customer asks
 * for a new package; with one, they ask for more credits for it.
 */
export function lowCreditAction(hasActivePackage: boolean | undefined): LowCreditAction {
  return hasActivePackage ? 'request-credits' : 'request-package'
}
