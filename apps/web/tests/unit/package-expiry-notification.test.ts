import { describe, expect, it } from 'vitest'
import { packageExpiryNotification } from '../../server/utils/package-expiry-notification'

describe('package expiry notification', () => {
  it('returns the most recently ended package when no replacement is active', () => {
    expect(packageExpiryNotification(null, {
      name: 'Paketa vjetore',
      endsAt: new Date('2026-10-26T00:00:00.000Z'),
    })).toEqual({
      packageName: 'Paketa vjetore',
      endedAt: '2026-10-26T00:00:00.000Z',
    })
  })

  it('does not notify when a replacement package is active', () => {
    expect(packageExpiryNotification({ name: 'Paketa e re' }, {
      name: 'Paketa e kaluar',
      endsAt: new Date('2026-10-26T00:00:00.000Z'),
    })).toBeNull()
  })
})
