import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

function databaseUrl() {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(new URL('../../../../.env', import.meta.url))
    } catch {
      // Hosted CI supplies DATABASE_URL directly and has no local .env file.
    }
  }
  const value = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for the session acceptance test.')
  return value
}

test('session guard rejects forged, revoked and expired sessions', async ({
  page,
  baseURL,
  playwright,
}) => {
  const origin = new URL(baseURL!).origin
  const email = `rrit-session-${randomUUID()}@example.test`
  const password = 'Session-test-' + randomUUID()
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 })

  try {
    const signup = await page.request.post('/api/auth/sign-up/email', {
      headers: { Origin: origin },
      data: { name: 'Testues sesioni', email, password, callbackURL: '/onboarding' },
    })
    expect(signup.status()).toBe(200)
    expect((await page.request.get('/api/business')).status()).toBe(200)

    const firstState = await page.request.storageState()
    const sessionCookie = firstState.cookies.find((cookie) => cookie.name.includes('session'))
    expect(sessionCookie).toBeTruthy()

    const signout = await page.request.post('/api/auth/sign-out', {
      headers: { Origin: origin },
      data: {},
    })
    expect(signout.status()).toBe(200)

    const replay = await playwright.request.newContext({ baseURL: origin, storageState: firstState })
    const revoked = await replay.get('/api/business')
    expect(revoked.status()).toBe(401)
    expect((await revoked.json()).data?.code).toBe('AUTH_REQUIRED')
    await replay.dispose()

    const signin = await page.request.post('/api/auth/sign-in/email', {
      headers: { Origin: origin },
      data: { email, password },
    })
    expect(signin.status()).toBe(200)
    const activeState = await page.request.storageState()
    const activeCookie = activeState.cookies.find((cookie) => cookie.name.includes('session'))!
    const forgedState = {
      ...activeState,
      cookies: activeState.cookies.map((cookie) =>
        cookie.name === activeCookie.name
          ? { ...cookie, value: cookie.value.slice(0, -1) + (cookie.value.endsWith('a') ? 'b' : 'a') }
          : cookie,
      ),
    }
    const forgedClient = await playwright.request.newContext({
      baseURL: origin,
      storageState: forgedState,
    })
    const forged = await forgedClient.get('/api/business')
    expect(forged.status()).toBe(401)
    expect((await forged.json()).data?.code).toBe('AUTH_REQUIRED')
    await forgedClient.dispose()

    await pool.query(
      `UPDATE "session" s
       SET "expiresAt" = now() - interval '1 second'
       FROM "user" u
       WHERE s."userId" = u.id AND u.email = $1`,
      [email],
    )
    const expired = await page.request.get('/api/business')
    expect(expired.status()).toBe(401)
    expect((await expired.json()).data?.code).toBe('AUTH_REQUIRED')
  } finally {
    await pool.query('DELETE FROM "user" WHERE email = $1', [email])
    await pool.end()
  }
})
