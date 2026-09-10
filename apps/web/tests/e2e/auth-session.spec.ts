import { expect, test } from '@playwright/test'
import { deleteAccount, signOut, signUp, type E2EAccount } from './helpers/auth'

test('session guard rejects signed-out, forged and deleted Supabase sessions', async ({
  page,
  baseURL,
  playwright,
}) => {
  const origin = new URL(baseURL!).origin
  const accounts: E2EAccount[] = []

  try {
    const first = await signUp(page, 'Testues sesioni')
    accounts.push(first)
    const firstState = await page.request.storageState()

    await signOut(page)
    const signedOut = await page.request.get('/api/business')
    expect(signedOut.status()).toBe(401)
    expect((await signedOut.json()).data?.code).toBe('AUTH_REQUIRED')

    const second = await signUp(page, 'Testues sesioni forged')
    accounts.push(second)
    const activeState = await page.request.storageState()
    const sessionCookies = activeState.cookies.filter((cookie) =>
      cookie.name.includes('auth-token'),
    )
    expect(sessionCookies.length).toBeGreaterThan(0)
    const forgedState = {
      ...activeState,
      cookies: activeState.cookies.map((cookie) =>
        cookie.name.includes('auth-token')
          ? { ...cookie, value: 'forged' }
          : cookie,
      ),
    }
    const forgedClient = await playwright.request.newContext({
      baseURL: origin,
      storageState: forgedState,
    })
    try {
      const forged = await forgedClient.get('/api/business')
      expect(forged.status()).toBe(401)
      expect((await forged.json()).data?.code).toBe('AUTH_REQUIRED')
    } finally {
      await forgedClient.dispose()
    }

    await deleteAccount(second.email)
    const deleted = await page.request.get('/api/business')
    expect(deleted.status()).toBe(401)
    expect((await deleted.json()).data?.code).toBe('AUTH_REQUIRED')

    // The first account's stored Supabase cookies are also rejected after its user is deleted.
    await deleteAccount(first.email)
    const replay = await playwright.request.newContext({ baseURL: origin, storageState: firstState })
    try {
      const revoked = await replay.get('/api/business')
      expect(revoked.status()).toBe(401)
      expect((await revoked.json()).data?.code).toBe('AUTH_REQUIRED')
    } finally {
      await replay.dispose()
    }
  } finally {
    for (const account of accounts) await deleteAccount(account.email)
  }
})
