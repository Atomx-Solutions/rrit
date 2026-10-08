import { expect, it } from 'vitest'
import { metaConnectionView } from '../../app/utils/meta-connection-view'

it('does not claim a missing Meta connection while the check is still loading', () => {
  expect(metaConnectionView('idle', null)).toBe('loading')
  expect(metaConnectionView('pending', null)).toBe('loading')
})

it('distinguishes connected, disconnected and failed checks', () => {
  expect(metaConnectionView('success', { status: 'connected' })).toBe('connected')
  expect(metaConnectionView('success', null)).toBe('disconnected')
  expect(metaConnectionView('error', null)).toBe('unavailable')
})
