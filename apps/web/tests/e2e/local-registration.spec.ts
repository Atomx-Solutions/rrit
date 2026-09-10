import { test, expect } from '@playwright/test'
import { signUp, signOut } from './helpers/auth'

test('registration opens onboarding without requiring an email confirmation', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin
  const account = await signUp(page, 'Regjistrim lokal')
  const capabilities = await (await page.request.get('/api/capabilities')).json()
  expect(capabilities.emailVerificationRequired).toBe(false)

  const business = await page.request.post(origin + '/api/business', {
    headers: { Origin: origin },
    data: {
      name: 'Biznesi lokal',
      city: 'Prishtinë',
      industry: 'Shërbime',
      description: 'Shërbime për klientët e biznesit tonë.',
      voice: 'Thjesht',
    },
  })
  expect(business.status()).toBe(201)
  const created = (await business.json()) as { id: string; slug: string }
  await page.goto(`/app/${created.id}/${created.slug}/overview`)

  const denied = await page.request.post(origin + '/api/business', {
    headers: { Origin: 'https://foreign.test' },
    data: {},
  })
  expect(denied.status()).toBe(403)

  await signOut(page)
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Hyr në llogari', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/[a-f0-9-]{36}\/biznesi-lokal\/overview$/, {
    timeout: 30000,
  })
})
