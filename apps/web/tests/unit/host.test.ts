import { afterEach, describe, expect, it, vi } from 'vitest'
import { onVercel } from '../../server/utils/host'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const builtFor = (vercel: boolean) => vi.stubGlobal('useRuntimeConfig', () => ({ onVercel: vercel }))

describe('whether the app runs on Vercel', () => {
  it('knows it from the build even when the running function does not see VERCEL', () => {
    vi.stubEnv('VERCEL', '')
    builtFor(true)
    expect(onVercel()).toBe(true)
  })

  it('knows it when the running function does see VERCEL', () => {
    vi.stubEnv('VERCEL', '1')
    builtFor(false)
    expect(onVercel()).toBe(true)
  })

  it('runs as a long-running server when it was not built for Vercel', () => {
    vi.stubEnv('VERCEL', '')
    builtFor(false)
    expect(onVercel()).toBe(false)
  })
})
