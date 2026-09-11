import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { signUp } from './helpers/auth'
import type { Workspace } from '../../shared/schemas/workspace'

type Business = {
  id: string
  slug: string
  workspace: Workspace
  brand?: { revision: number; name: string; profile: Record<string, unknown>; timezone: string; locale: string }
}

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/business')
  expect(response.status()).toBe(200)
  return (await response.json()).business as Business
}

async function createBusiness(page: Page) {
  const account = await signUp(page, 'Brand settings E2E')
  const origin = new URL((await page.request.get('/api/health/live')).url()).origin
  const response = await page.request.post('/api/business', {
    headers: { Origin: origin },
    data: {
      name: 'Brand Settings Test',
      city: 'Prishtine',
      industry: 'Sherbime',
      description: 'Sherbime reale per klientet e biznesit.',
      voice: 'E qarte dhe miqesore',
    },
  })
  expect(response.status()).toBe(201)
  return { account, business: await workspace(page.request), origin }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('brand settings persist profile, goals, locale and timezone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 })
  const { business, origin } = await createBusiness(page)
  const base = `/app/${business.id}/${business.slug}`

  await page.goto(base + '/brand')
  await expect(page.getByRole('heading', { name: 'Profili i biznesit' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByLabel('Emri i biznesit', { exact: true }).fill('Brand Settings Updated')
  await page.getByLabel('Qyteti', { exact: true }).fill('Rahovec')
  await page.getByLabel('Lloji i biznesit', { exact: true }).fill('Auto')
  await page.getByLabel('Çfarë ofron për klientët?', { exact: true }).fill('Servis real dhe i kontrolluar për klientët.')
  await page.getByRole('button', { name: 'Shto qëllim', exact: true }).click()
  await page.getByPlaceholder('P.sh. Gjej klientë të rinj').fill('Gjej klientë të rinj')
  await page.getByLabel('Facebook URL', { exact: true }).fill('abc')
  await page.getByRole('button', { name: 'Ruaj identitetin', exact: true }).click()
  await expect(page.getByText('Vendos një URL valide.', { exact: true })).toBeVisible()
  await page.getByLabel('Facebook URL', { exact: true }).fill('https://facebook.com/brand-settings')
  await page.getByRole('button', { name: 'Ruaj identitetin', exact: true }).click()
  await expect(page.getByText('Identiteti i biznesit u ruajt')).toBeVisible()

  await page.goto(base + '/settings?tab=preferences')
  await expectNoHorizontalOverflow(page)
  await page.getByLabel('Gjuha', { exact: true }).click()
  await page.getByRole('option', { name: 'English · United States', exact: true }).click()
  await page.getByLabel('Zona kohore', { exact: true }).click()
  await page.getByRole('option', { name: 'Shqipëri · ora lokale', exact: true }).click()
  await page.getByRole('button', { name: 'Ruaj ndryshimet', exact: true }).click()
  await expect(page.getByText('Ndryshimet u ruajtën')).toBeVisible()

  const saved = await workspace(page.request)
  expect(saved.workspace.brand).toMatchObject({
    name: 'Brand Settings Updated',
    city: 'Rahovec',
    industry: 'Auto',
    goals: ['Gjej klientë të rinj'],
    facebookUrl: 'https://facebook.com/brand-settings',
  })
  expect(saved.workspace.preferences).toMatchObject({ locale: 'en-US', timezone: 'Europe/Tirane' })

  const canonical = await page.request.get(`/api/organizations/${business.id}/brands`)
  expect(canonical.status()).toBe(200)
  const brands = (await canonical.json()) as Array<{ name: string; revision: number; profile: Record<string, unknown>; timezone: string; locale: string }>
  expect(brands).toHaveLength(1)
  expect(brands[0]).toMatchObject({
    name: 'Brand Settings Updated',
    timezone: 'Europe/Tirane',
    locale: 'en-US',
    profile: { city: 'Rahovec', goals: ['Gjej klientë të rinj'] },
  })
  expect(brands[0]!.revision).toBeGreaterThan(1)
  expect(origin).toMatch(/^http/)

  await page.reload()
  await expect(page.getByLabel('Zona kohore', { exact: true })).toHaveValue('Europe/Tirane')
})

test('brand settings show a conflict instead of overwriting a newer revision', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 })
  const { business, origin } = await createBusiness(page)
  const base = `/app/${business.id}/${business.slug}`
  await page.goto(base + '/brand')

  const stale = await workspace(page.request)
  const external = structuredClone(stale.workspace)
  external.revision++
  external.brand.name = 'External Brand Update'
  const externalSave = await page.request.put(`/api/workspaces/${business.id}`, {
    headers: { Origin: origin },
    data: external,
  })
  expect(externalSave.status()).toBe(200)

  await page.getByLabel('Emri i biznesit', { exact: true }).fill('Local Brand Update')
  await page.getByRole('button', { name: 'Ruaj identitetin', exact: true }).click()
  await expect(page.getByText('Ka ndryshime nga një skedë tjetër')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ngarko versionin e fundit', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ngarko versionin e fundit', exact: true }).click()
  await expect(page.getByLabel('Emri i biznesit', { exact: true })).toHaveValue('External Brand Update')
  await expectNoHorizontalOverflow(page)
})
