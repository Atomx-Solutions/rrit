import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { signUp } from './helpers/auth'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Workspace } from '../../shared/schemas/workspace'

async function verifiedAccount(page: Page) {
  return signUp(page, 'Testuesi Rrit')
}
async function state(request: APIRequestContext) {
  const response = await request.get('/api/business')
  expect(response.status()).toBe(200)
  return (await response.json()).business as { id: string; slug: string; workspace: Workspace }
}
test('verified business, private content, validation and paginated dashboard', async ({
  page,
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout(120000)
  const origin = new URL(baseURL!).origin
  await verifiedAccount(page)
  await page.goto('/onboarding')
  await page.getByLabel('Emri i biznesit', { exact: true }).fill('Studio Testi')
  await page.getByLabel('Qyteti', { exact: true }).fill('Prishtinë')
  await page.getByLabel('Lloji i biznesit', { exact: true }).fill('Dyqan')
  await page
    .getByLabel('Çfarë ofron për klientët?', { exact: true })
    .fill('Produkte të punuara me dorë për klientët tanë.')
  await page.getByRole('button', { name: 'Vazhdo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Profilet që përdor biznesi.' })).toBeVisible()
  await page.getByRole('button', { name: 'Ruaj dhe vazhdo', exact: true }).click()
  await page.getByRole('button', { name: 'Krijo postimin e parë', exact: true }).click()
  await expect(page).toHaveURL(/\/content\/new$/)
  const initial = await state(page.request)
  const base = `/app/${initial.id}/${initial.slug}`
  expect(initial.workspace.posts).toHaveLength(0)
  expect(initial.workspace.assets).toHaveLength(0)
  const trial = await (await page.request.get('/api/trial')).json()
  expect(trial.state).toBe('active')
  expect(Date.parse(trial.expiresAt) - Date.parse(trial.startsAt)).toBe(72 * 3600000)
  await expect(page.getByText(/Trial falas ·/)).toBeVisible()
  await page.getByLabel('Emri i postimit', { exact: true }).fill('Produkti i javës')
  await page
    .getByLabel('Teksti i postimit', { exact: true })
    .fill('Punuar me kujdes. Na shkruaj për më shumë informacion.')
  await page.getByRole('button', { name: 'Shto fotografi', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Fotografia e postimit' })
  await dialog.getByRole('checkbox').check()
  await dialog
    .locator('input[type=file]')
    .setInputFiles({
      name: 'produkt.jpg',
      mimeType: 'image/jpeg',
      buffer: await readFile(new URL('../../public/images/table.jpg', import.meta.url)),
    })
  await expect(dialog).toBeHidden({ timeout: 15000 })
  await expect(page).toHaveURL(/\/content\/[a-f0-9-]{36}$/, { timeout: 15000 })
  const saved = await state(page.request),
    post = saved.workspace.posts[0]!
  expect(post.policy).not.toBe('pass')
  expect(post.image).toMatch(/^\/api\/media\//)
  await page.reload()
  await expect(page.getByLabel('Emri i postimit', { exact: true })).toHaveValue('Produkti i javës')
  await page.getByLabel('Kanali', { exact: true }).click()
  await page.getByRole('option', { name: 'Facebook', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Parapamja në Facebook' })).toBeVisible()
  await expect(page.getByText('Pëlqe', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await state(page.request)).workspace.posts[0]?.channel)
    .toBe('Facebook')
  await page.getByRole('button', { name: 'Kontrollo përmbajtjen', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Rezultati i kontrolleve' })).toBeVisible({
    timeout: 15000,
  })
  const checked = await state(page.request)
  expect(checked.workspace.posts[0]?.policy).toBe('pass') // Meta is optional for approval and calendar.
  await page.getByRole('button', { name: 'Dërgo për miratim', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mirato postimin', exact: true })).toBeDisabled()
  const foreign = await browser.newContext()
  try {
    await expect((await foreign.request.get(origin + post.image)).status()).toBe(401)
    const forged = structuredClone((await state(page.request)).workspace)
    forged.revision++
    forged.posts[0]!.status = 'published'
    forged.posts[0]!.policy = 'pass'
    const response = await page.request.put(`/api/workspaces/${saved.id}`, {
      headers: { Origin: origin },
      data: forged,
    })
    expect(response.status()).toBe(422)
    const csrf = await page.request.put(`/api/workspaces/${saved.id}`, {
      headers: { Origin: 'https://foreign.test' },
      data: forged,
    })
    expect(csrf.status()).toBe(403)
  } finally {
    await foreign.close()
  }
  // Create enough actual DB rows to exercise list pagination, with server-owned state.
  const current = (await state(page.request)).workspace
  current.revision++
  for (let i = 0; i < 12; i++)
    current.posts.push({
      ...post,
      id: randomUUID(),
      title: `Postimi ${i + 1}`,
      status: 'draft',
      policy: 'pass',
      version: 999,
    })
  const inserted = await page.request.put(`/api/workspaces/${saved.id}`, {
    headers: { Origin: origin },
    data: current,
  })
  expect(inserted.status()).toBe(200)
  const insertedData = await inserted.json()
  expect(
    insertedData.workspace.posts.filter((p: { version: number }) => p.version === 999),
  ).toHaveLength(0)
  expect(
    (
      await page.request.put(`/api/workspaces/${saved.id}`, {
        headers: { Origin: origin },
        data: current,
      })
    ).status(),
  ).toBe(409)
  await page.goto(base + '/content')
  await expect(page.getByText('1–10 nga 13', { exact: true })).toBeVisible()
  // Compact pagination displays the current number and next/previous controls.
  await page.getByRole('button', { name: 'Next Page', exact: true }).click()
  await expect(page.getByText('11–13 nga 13', { exact: true })).toBeVisible()
  await page.goto(base + '/overview')
  await expect(page.getByRole('link', { name: 'Produkti i javës', exact: true })).toBeHidden()
  for (const route of [
    'overview',
    'content',
    'gallery',
    'calendar',
    'social-posts',
    'billing',
    'settings?tab=security',
  ]) {
    await page.goto(base + '/' + route)
    await expect(page.locator('main')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(
      accessibility.violations.map((issue) => ({
        id: issue.id,
        nodes: issue.nodes.map((node) => node.target),
      })),
    ).toEqual([])
  }
  await page.goto(base + '/overview')
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true })
})
test('public pages offer real registration with no demonstration routes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Postime që')
  await expect(page.locator('a[href*="/app/demo"]')).toHaveCount(0)
  await expect(page.getByText(/3 ditë trial falas/).first()).toBeVisible()
  await page.goto('/signup')
  await expect(
    page.getByRole('button', { name: 'Krijo llogarinë e biznesit', exact: true }),
  ).toBeVisible()
  await page.goto('/app/demo/mulliri/overview')
  await expect(page).toHaveURL(/\/login/)
})
