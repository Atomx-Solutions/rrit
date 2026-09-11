import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { signOut, signUp } from './helpers/auth'
import type { Workspace } from '../../shared/schemas/workspace'

async function workspace(page: Page) {
  const response = await page.request.get('/api/business')
  expect(response.status()).toBe(200)
  return (await response.json()).business as { id: string; slug: string; workspace: Workspace }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const blocking = result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => violation.id)
  expect(blocking).toEqual([])
}

test('onboarding restores drafts and completes the first-post lifecycle', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000)
  const account = await signUp(page, 'Resume onboarding')
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page)

  await page.locator('input[name="name"]').fill('Biznesi Resume')
  await page.locator('input[name="city"]').fill('Prishtine')
  await page.locator('input[name="industry"]').fill('Sherbime')
  await page.locator('textarea[name="description"]').fill('Sherbime reale per klientet e biznesit.')
  await page.getByLabel('Zona kohore').click()
  await page.getByRole('option', { name: 'Shqiperi - ora lokale', exact: true }).click()
  await page.getByLabel('Gjuha').click()
  await page.getByRole('option', { name: 'English', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Gjej kliente te rinj', exact: true }).check()
  await page.getByRole('button', { name: 'Shto fakt', exact: true }).click()
  await page.getByPlaceholder('Fakti 1').fill('Adresa reale e biznesit')

  await page.reload()
  await expect(page.locator('input[name="name"]')).toHaveValue('Biznesi Resume')
  await expect(page.locator('textarea[name="description"]')).toHaveValue(
    'Sherbime reale per klientet e biznesit.',
  )
  await expect(
    page.getByRole('checkbox', { name: 'Gjej kliente te rinj', exact: true }),
  ).toBeChecked()

  await page.getByRole('button', { name: 'Vazhdo', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Profilet q/ })).toBeVisible()
  await expectAccessible(page)
  const saved = await workspace(page)
  expect(saved.workspace.onboarding).toBe(1)
  expect(saved.workspace.preferences).toMatchObject({ timezone: 'Europe/Tirane', locale: 'en-US' })
  expect(saved.workspace.brand.goals).toContain('Gjej kliente te rinj')
  expect(saved.workspace.brand.facts[0]?.text).toBe('Adresa reale e biznesit')

  await page.reload()
  await expect(page.getByRole('heading', { name: /Profilet q/ })).toBeVisible()
  await page.getByRole('button', { name: 'Ruaj dhe vazhdo', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Gati p/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page)
  expect((await workspace(page)).workspace.onboarding).toBe(2)

  await page.reload()
  await expect(page.getByRole('heading', { name: /Gati p/ })).toBeVisible()
  await signOut(page)
  await page.locator('input[autocomplete="email"]').fill(account.email)
  await page.locator('input[autocomplete="current-password"]').fill(account.password)
  await page.locator('form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30000 })
  await expect(page.getByRole('heading', { name: /Gati p/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: /Krijo postimin e par/ }).click()
  await expect(page).toHaveURL(/\/content\/new$/)
  expect((await workspace(page)).workspace.onboarding).toBe(3)

  await page.getByLabel('Emri i postimit', { exact: true }).fill('Postimi i pare')
  await page
    .getByLabel('Teksti i postimit', { exact: true })
    .fill('Sherbime reale per klientet e biznesit.')
  await page.getByRole('button', { name: 'Shto fotografi', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Fotografia e postimit/ })
  await dialog.getByRole('checkbox').check()
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'biznesi.jpg',
    mimeType: 'image/jpeg',
    buffer: await readFile(new URL('../../public/images/table.jpg', import.meta.url)),
  })
  await expect(page).toHaveURL(/\/content\/[a-f0-9-]{36}$/)
  await page.getByRole('button', { name: /D.*rgo p.*miratim/ }).click()
  await page.getByRole('checkbox', { name: /I kontrollova/ }).check()
  await page.getByRole('button', { name: /Mirato postimin/ }).click()
  await expect(page.getByRole('button', { name: /Planifiko postimin/ })).toBeVisible()

  await page.getByRole('button', { name: /Planifiko postimin/ }).click()
  const scheduleDialog = page.getByRole('dialog', { name: /Shto n.*kalendar/ })
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + 'T11:00'
  await scheduleDialog.locator('input[type="datetime-local"]').fill(future)
  await scheduleDialog.getByRole('button', { name: /Konfirmo orarin/ }).click()
  await expect(scheduleDialog).toBeHidden()
  await expect.poll(async () => (await workspace(page)).workspace.onboarding).toBe(4)
  await page.reload()
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/overview$/)

  const freshContext = await browser.newContext({ baseURL: baseURL! })
  try {
    const freshPage = await freshContext.newPage()
    await freshPage.goto('/login')
    await freshPage.locator('input[autocomplete="email"]').fill(account.email)
    await freshPage.locator('input[autocomplete="current-password"]').fill(account.password)
    await freshPage.locator('form button[type="submit"]').click()
    await expect(freshPage).toHaveURL(/\/overview$/, { timeout: 30000 })
  } finally {
    await freshContext.close()
  }
})
