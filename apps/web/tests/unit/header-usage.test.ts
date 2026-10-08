import { afterEach, expect, it, vi } from 'vitest'
import { useHeaderUsage } from '../../app/composables/useHeaderUsage'

afterEach(() => vi.unstubAllGlobals())

it('starts the shared credit snapshot without blocking dashboard navigation', () => {
  const snapshot = { data: { value: null }, error: { value: null }, refresh: vi.fn() }
  const useFetch = vi.fn(() => snapshot)
  vi.stubGlobal('useFetch', useFetch)

  expect(useHeaderUsage()).toBe(snapshot)
  expect(useFetch).toHaveBeenCalledWith('/api/usage', {
    key: 'header-credit-balance',
    lazy: true,
    server: false,
  })
})
