/** The public package journey starts with a request based on monthly posts. */
export const publicOfferCta = {
  to: '/#cmimet',
  labelKey: 'landing.requestOffer',
} as const

/** The free-trial journey is handled through business registration. */
export const publicTrialCta = {
  to: '/signup',
  labelKey: 'landing.tryThreePostsFree',
} as const
