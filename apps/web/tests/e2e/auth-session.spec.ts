import { expect, test } from '@playwright/test'
import { deleteAccount, signOut, signUp, type E2EAccount } from './helpers/auth'

async function createBusiness(page: import('@playwright/test').Page, name: string) {
  const response = await page.request.post('/api/business', {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      name,
      city: 'PrishtinÃ«',
      industry: 'Test',
      description: 'Llogari e krijuar vetëm për testimin E2E.',
      voice: 'Thjesht',
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { id: string; slug: string }
}

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
    const firstBusiness = await createBusiness(page, 'Biznesi i sesionit')
    await page.goto(`/app/${firstBusiness.id}/${firstBusiness.slug}/overview`)
    const firstState = await page.request.storageState()

    await signOut(page)
    const signedOut = await page.request.get('/api/business')
    expect(signedOut.status()).toBe(401)
    expect((await signedOut.json()).data?.code).toBe('AUTH_REQUIRED')

    const second = await signUp(page, 'Testues sesioni forged')
    accounts.push(second)
    const secondBusiness = await createBusiness(page, 'Biznesi forged')
    await page.goto(`/app/${secondBusiness.id}/${secondBusiness.slug}/overview`)
    const activeState = await page.request.storageState()
    const sessionCookies = activeState.cookies.filter((cookie) =>
      cookie.name.includes('auth-token'),
    )
    expect(sessionCookies.length).toBeGreaterThan(0)
    const forgedState = {
      ...activeState,
      cookies: activeState.cookies.map((cookie) =>
        cookie.name === sessionCookies[0]!.name
          ? { ...cookie, value: cookie.value.slice(0, -1) + (cookie.value.endsWith('a') ? 'b' : 'a') }
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
