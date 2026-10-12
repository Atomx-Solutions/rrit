import { describe, expect, it } from 'vitest'
import { publicOfferCta, publicTrialCta } from '../../app/utils/landing-offer'

describe('public landing CTAs', () => {
  it('takes visitors to the monthly-post offer form', () => {
    expect(publicOfferCta).toEqual({
      to: '/#pricing',
      labelKey: 'landing.requestOffer',
    })
  })

  it('takes visitors to registration for three free posts', () => {
    expect(publicTrialCta).toEqual({
      to: '/signup',
      labelKey: 'landing.tryThreePostsFree',
    })
  })
})
