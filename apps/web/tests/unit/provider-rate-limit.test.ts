import { describe, expect, it, vi } from 'vitest'
import { rateLimitPause, rateLimitSettings, sendWithRateLimitRetry } from '../../server/utils/provider-rate-limit'
import { plannerRetryDelaySeconds, plannerRunSettings } from '../../server/utils/monthly-planner-domain'
import { recoverPriorRun } from '../../server/utils/monthly-ai'

const settings = rateLimitSettings({
  OPENROUTER_RATE_LIMIT_WAIT_SECONDS: '60',
  OPENROUTER_RATE_LIMIT_BASE_SECONDS: '2',
  OPENROUTER_RATE_LIMIT_MAX_STEP_SECONDS: '30',
})

function fakeClock(random = 1) {
  let time = 0
  return {
    now: () => time,
    sleep: vi.fn(async (ms: number) => {
      time += ms
    }),
    random: () => random,
  }
}
const answer = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers })

describe('a request the provider rate-limited', () => {
  it('is sent again after the wait the provider asks for', async () => {
    const clock = fakeClock()
    const answers = [answer(429, { 'retry-after': '5' }), answer(200)]
    const send = vi.fn(async () => answers.shift()!)
    const response = await sendWithRateLimitRetry(send, settings, clock)
    expect(response.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect(clock.sleep).toHaveBeenCalledWith(5000)
  })

  it('waits a random share of a doubling step when the provider names no wait', () => {
    const clock = { now: () => 0, random: () => 0.5 }
    expect(rateLimitPause(1, null, settings, clock)).toBe(2000)
    expect(rateLimitPause(3, null, settings, clock)).toBe(4000)
    // The step stops growing at its longest.
    expect(rateLimitPause(10, null, settings, { now: () => 0, random: () => 1 })).toBe(30000)
    // Never shorter than the first pause.
    expect(rateLimitPause(2, null, settings, { now: () => 0, random: () => 0 })).toBe(2000)
  })

  it('hands the refusal back once another wait would pass its budget', async () => {
    const clock = fakeClock()
    const send = vi.fn(async () => answer(429, { 'retry-after': '25' }))
    const response = await sendWithRateLimitRetry(send, settings, clock)
    expect(response.status).toBe(429)
    // 25s and 25s fit in 60s; a third wait would not.
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('returns any other answer at once, never sending it twice', async () => {
    for (const status of [200, 400, 500, 502]) {
      const send = vi.fn(async () => answer(status))
      expect((await sendWithRateLimitRetry(send, settings, fakeClock())).status).toBe(status)
      expect(send).toHaveBeenCalledTimes(1)
    }
  })
})

describe('a plan the provider rate-limited', () => {
  const planner = plannerRunSettings({ PLANNER_RATE_LIMIT_DELAY_SECONDS: '60', PLANNER_RETRY_DELAY_SECONDS: '15' })

  it('returns between one and two delays later, at random', () => {
    expect(plannerRetryDelaySeconds('PROVIDER_RATE_LIMITED', planner, () => 0)).toBe(60)
    expect(plannerRetryDelaySeconds('PROVIDER_RATE_LIMITED', planner, () => 0.5)).toBe(90)
    expect(plannerRetryDelaySeconds('PROVIDER_TEMPORARY', planner, () => 0.5)).toBe(15)
  })

  it('calls a rate-limited stage again more times than one that failed', async () => {
    const limit = plannerRunSettings().rateLimitRetries
    const run = { id: 'run-1', status: 'failed', error_code: 'PROVIDER_RATE_LIMITED' }
    await expect(recoverPriorRun({ ...run, retry_count: 3 })).resolves.toMatchObject({ id: 'run-1' })
    await expect(recoverPriorRun({ ...run, retry_count: limit })).rejects.toMatchObject({ code: 'PROVIDER_RETRY_EXHAUSTED' })
    await expect(recoverPriorRun({ ...run, error_code: 'PROVIDER_TEMPORARY', retry_count: 3 })).rejects.toMatchObject({ code: 'PROVIDER_RETRY_EXHAUSTED' })
  })
})
