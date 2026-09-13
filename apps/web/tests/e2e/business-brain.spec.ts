import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createDemo } from '../fixtures/workspace'

// Explicit browser contract fixtures; lifecycle/RLS are tested against PostgreSQL.
test('fact edits require confirmation and offer fields remain usable on mobile', async ({
  page,
}, info) => {
  const id = randomUUID()
  const workspace = createDemo()
  const business = { id, slug: 'brain-test', workspace }
  let saves = 0
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = {}
    if (path === '/api/business')
      json = { user: { name: 'Testuesi', email: 'test@example.test' }, business }
    else if (path === '/api/trial')
      json = {
        paid: true,
        state: 'active',
        secondsRemaining: 3600,
        limits: { posts_per_month: 30 },
      }
    else if (path === '/api/business/brain-history')
      json = {
        versions: [{ version: 2, createdAt: new Date().toISOString(), brand: workspace.brand }],
      }
    else if (path === `/api/workspaces/${id}`) {
      const input = route.request().postDataJSON()
      workspace.brand = input.brand
      saves++
      json = business
    }
    return route.fulfill({ json })
  })
  await page.goto(`/app/${id}/brain-test/brand`)
  await page.getByRole('button', { name: 'Detaje që postimet duhet t’i kenë të sakta' }).click()
  const confirmation = page
    .getByRole('checkbox', { name: 'E kam kontrolluar këtë informacion' })
    .first()
  await expect(confirmation).toBeChecked()
  await page.getByLabel('Detaji 1', { exact: true }).fill('Ofertë kafeje për klientët e lagjes.')
  await expect(confirmation).not.toBeChecked()
  await page.getByLabel('Lloji', { exact: true }).first().click()
  await page.getByRole('option', { name: 'Ofertë', exact: true }).click()
  await page.getByLabel('Vlen nga', { exact: true }).first().fill('2026-10-10')
  await page.getByLabel('Vlen deri', { exact: true }).first().fill('2026-10-15')
  await page.getByLabel('Çmimi në EUR (opsional)').fill('2.50')
  await expect(confirmation).not.toBeChecked()
  await page.getByRole('button', { name: 'Burime për hulumtim' }).click()
  await page.getByRole('button', { name: 'Shto burim', exact: true }).click()
  await page.getByLabel('Burimi 1', { exact: true }).fill('https://business.example/menu')
  await page.screenshot({ path: info.outputPath('business-brain.png'), fullPage: true })
  await page.getByRole('button', { name: 'Ruaj identitetin', exact: true }).click()
  await expect.poll(() => saves).toBe(1)
  expect(workspace.brand.facts[0]).toMatchObject({
    verified: false,
    kind: 'offer',
    validFrom: '2026-10-10',
    validUntil: '2026-10-15',
    amountCents: 250,
    currency: 'EUR',
  })
  expect(workspace.brand.researchSources).toEqual(['https://business.example/menu'])
  await page.getByRole('button', { name: 'Historiku i profilit' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Versioni 2' }).click()
  await expect(
    page.getByRole('dialog').getByText('Ofertë kafeje për klientët e lagjes.', { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('dialog')
      .getByText(/Pa konfirmim/)
      .first(),
  ).toBeVisible()
})
