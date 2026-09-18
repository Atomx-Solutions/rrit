import { describe, expect, it, vi } from 'vitest'
import { lowCreditAction, showLowCreditReminder } from '../../app/utils/low-credit'
import { lowCreditStatus } from '../../server/utils/credits'

describe('low-credit reminder', () => {
  it('shows a top-up reminder to a customer with an active package and 80 credits', () => {
    expect(showLowCreditReminder(80, 100, null)).toBe(true)
    expect(lowCreditAction(true)).toBe('top-up')
  })

  it('sends a customer without an active package and 80 credits to choose a package', () => {
    expect(showLowCreditReminder(80, 100, null)).toBe(true)
    expect(lowCreditAction(false)).toBe('choose-plan')
  })

  it('stays hidden for a customer with 150 credits', () => {
    expect(showLowCreditReminder(150, 100, null)).toBe(false)
    expect(showLowCreditReminder(100, 100, null)).toBe(false)
  })

  it('stays dismissed until the balance drops again', () => {
    expect(showLowCreditReminder(80, 100, 80)).toBe(false)
    expect(showLowCreditReminder(79, 100, 80)).toBe(true)
  })

  it('reads the threshold from configuration and the package from subscriptions', async () => {
    const query = vi.fn(async () => ({ rows: [{ low_credit_threshold: 250, has_active_package: false }] }))
    await expect(lowCreditStatus({ query } as never, 'org')).resolves.toEqual({ threshold: 250, hasActivePackage: false })
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain('low_credit_threshold')
  })
})
