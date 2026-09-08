import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('local registration opens onboarding without sending a verification email', async ({
  page,
  baseURL,
}, testInfo) => {
  const target = new URL(baseURL!)
  const origin =
    testInfo.project.name === 'mobile'
      ? target.origin
      : `${target.protocol}//localhost:${target.port}`
  const email = `rrit-local-${randomUUID()}@example.test`
  const password = 'Temporary-' + randomUUID()
  await page.goto(origin + '/signup')
  await page.getByLabel('Emri i plotë', { exact: true }).fill('Regjistrim lokal')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Krijo llogarinë e biznesit', exact: true }).click()
  await expect(page).toHaveURL(origin + '/onboarding', { timeout: 15000 })
  const session = await (await page.request.get(origin + '/api/auth/get-session')).json()
  expect(session.user.email).toBe(email)
  expect(session.user.emailVerified).toBe(false)
  const messages = await (await page.request.get('http://127.0.0.1:8029/api/v1/messages')).json()
  expect(
    messages.messages.some((item: { To: { Address: string }[] }) =>
      item.To.some((to) => to.Address === email),
    ),
  ).toBe(false)
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
  const denied = await page.request.post(origin + '/api/business', {
    headers: { Origin: 'https://foreign.test' },
    data: {},
  })
  expect(denied.status()).toBe(403)
  await page.request.post(origin + '/api/auth/sign-out', { headers: { Origin: origin }, data: {} })
  await page.goto(origin + '/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Hyr në llogari', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/[a-f0-9-]{36}\/biznesi-lokal\/overview$/, { timeout: 15000 })
})
