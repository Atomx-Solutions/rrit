import { parseRetryAfter } from './meta'

function positiveSetting(value: string | undefined, fallback: number) {
  const configured = Number(value)
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

/**
 * How long a request the provider turned away as rate-limited (429) is sent
 * again before the refusal is handed back. A 429 is refused before any work,
 * so it is never billed and is always safe to send again; the wait spreads
 * many businesses' requests out instead of failing them.
 *
 * - waitMs: how long, in all, one request may wait for the provider.
 * - baseMs / maxStepMs: the first and the longest pause between two tries
 *   when the provider names no wait of its own.
 */
export function rateLimitSettings(env: Record<string, string | undefined> = process.env) {
  return {
    waitMs: positiveSetting(env.OPENROUTER_RATE_LIMIT_WAIT_SECONDS, 60) * 1000,
    baseMs: positiveSetting(env.OPENROUTER_RATE_LIMIT_BASE_SECONDS, 2) * 1000,
    maxStepMs: positiveSetting(env.OPENROUTER_RATE_LIMIT_MAX_STEP_SECONDS, 30) * 1000,
  }
}

export type RateLimitSettings = ReturnType<typeof rateLimitSettings>
export type RateLimitClock = { now: () => number; sleep: (ms: number) => Promise<void>; random: () => number }

const realClock: RateLimitClock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
}

/**
 * The pause before try `attempt + 1`: what the provider asked for, or a random
 * share of a doubling step, so businesses refused at the same moment do not
 * all come back at the same moment.
 */
export function rateLimitPause(
  attempt: number,
  retryAfter: string | null,
  settings: RateLimitSettings,
  clock: Pick<RateLimitClock, 'now' | 'random'> = realClock,
) {
  const asked = parseRetryAfter(retryAfter, clock.now())
  if (asked) return asked * 1000
  const step = Math.min(settings.maxStepMs, settings.baseMs * 2 ** (attempt - 1))
  return Math.max(settings.baseMs, Math.round(step * clock.random()))
}

/**
 * Sends a provider request, and sends it again while the provider answers 429
 * and the wait so far leaves room for the pause it needs. Any other answer,
 * or a 429 that would wait past `waitMs`, is returned as it is for the caller
 * to handle. `send` builds the request anew each time, with its own timeout.
 */
export async function sendWithRateLimitRetry(
  send: () => Promise<Response>,
  settings: RateLimitSettings = rateLimitSettings(),
  clock: RateLimitClock = realClock,
) {
  const started = clock.now()
  for (let attempt = 1; ; attempt++) {
    const response = await send()
    if (response.status !== 429) return response
    const pause = rateLimitPause(attempt, response.headers.get('retry-after'), settings, clock)
    if (clock.now() - started + pause > settings.waitMs) return response
    // The refused answer is read to its end so its connection is let go.
    await response.arrayBuffer().catch(() => undefined)
    console.info('The AI provider asked to slow down; the request is sent again.', { attempt, pauseMs: pause })
    await clock.sleep(pause)
  }
}
