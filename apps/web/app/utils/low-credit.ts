export type LowCreditAction = 'top-up' | 'choose-plan'

/**
 * The reminder shows below the threshold unless the customer dismissed it in
 * this session; a dismissal lasts only while the balance stays at or above
 * the balance it was dismissed at.
 */
export function showLowCreditReminder(spendable: number, threshold: number, dismissedAt: number | null) {
  if (spendable >= threshold) return false
  return dismissedAt === null || spendable < dismissedAt
}

export function lowCreditAction(hasActivePackage: boolean): LowCreditAction {
  return hasActivePackage ? 'top-up' : 'choose-plan'
}
