import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createDemo } from '../fixtures/workspace'

const usageFixture = {
  plan: 'business',
  state: 'active',
  credits: { available: 1000, used: 0, limit: 1000, percentage: 100, state: 'available' },
  usage: [],
}

// Browser-only contract fixtures. No provider call, customer account or database
// is used; database/provider orchestration is exercised in the integration suite.
test('monthly drafts, visible research citations and creative editing', async ({ page }, info) => {
  const id = randomUUID(),
    postId = randomUUID(),
    assetId = randomUUID(),
    unrelatedAssetId = randomUUID(),
    planId = randomUUID()
  const workspace = createDemo()
  const now = new Date()
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: workspace.preferences.timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(now)
  const image = await readFile(new URL('../../public/images/coffee.jpg', import.meta.url))
  const original = workspace.posts[0]!
  workspace.assets = [
    {
      id: assetId,
      name: 'Kafeja e biznesit',
      tags: [],
      rights: true,
      kind: 'photo',
      size: image.length,
      url: `/api/media/${assetId}`,
    },
    {
      id: unrelatedAssetId,
      name: 'Fotografi tjetër nga galeria',
      tags: [],
      rights: true,
      kind: 'photo',
      size: image.length,
      url: `/api/media/${unrelatedAssetId}`,
    },
  ]
  workspace.posts = [
    {
      ...original,
      id: postId,
      title: 'Rituali i kafesë',
      caption: 'Kafe dhe ëmbëlsira për ditën tënde.',
      image: `/api/media/${assetId}`,
      status: 'draft',
      scheduledAt: null,
      proposedAt: now.toISOString(),
      version: 1,
      contentVersion: 1,
      aiProvenance: {
        planId,
        slot: 0,
        evidenceHash: 'fixture',
        factIds: ['f2'],
        sourceUrls: ['https://example.test/market'],
        hashtags: ['#AurumRestaurant', '#DarkaNePrishtine'],
        reasoning: {
          concept: 'Koncepti e lidh atmosferen e restorantit me nje darke te qete.',
          copy: 'Titulli eshte i shkurter dhe teksti jep nje arsye konkrete per vizite.',
          design: 'Hierarki e qarte, kontrast i matur dhe fotografia mbetet elementi kryesor.',
          hashtags: 'Etiketa e markes kombinohet me nje etikete lokale me intent te qarte.',
          photo: 'Fotografia perputhet me ambientin dhe nuk eshte perdorur se fundmi.',
          platform: 'Formati editorial i pershtatet sjelljes se audiences ne Instagram.',
          timing: 'Ora mbeshtetet ne dritaren e angazhimit para darkes.',
        },
        rationale: 'Kjo ide lidh produktin e biznesit me një ritual të përditshëm.',
        assetId,
        creative: {
          headline: 'Koha për një kafe',
          eyebrow: 'Në lagje',
          cta: 'Na vizito',
          layout: 'editorial',
        },
        quality: {
          decision: 'PASS',
          reasons: ['Rishikim testues'],
          factuality: true,
          brandFit: true,
          visualQuality: true,
        },
        promptVersion: 'fixture',
      },
    },
  ]
  const business = { id, slug: 'monthly-test', workspace }
  let aiEdited = false
  let reviewedVersion = 0
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = {}
    if (path.startsWith('/api/media/'))
      return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path === '/api/business')
      json = { user: { name: 'Testuesi', email: 'test@example.test' }, business }
    else if (path === '/api/usage') json = usageFixture
    else if (path === '/api/trial')
      json = {
        paid: true,
        state: 'active',
        secondsRemaining: 3600,
        limits: { posts_per_month: 30 },
      }
    else if (path === '/api/templates') json = []
    else if (path === '/api/meta/status') json = { connection: null }
    else if (path === '/api/capabilities') json = { ai: false, publishing: false }
    else if (path === '/api/ai/monthly-plan')
      json = {
        month,
        configured: true,
        entitled: true,
        enabled: true,
        limit: 30,
        workerAlive: true,
        prerequisite: null,
        plan: {
          id: planId,
          status: 'review',
          stage: 'complete',
          total: 1,
          completed: 1,
          errorCode: null,
          error: null,
          restartable: false,
          updatedAt: now.toISOString(),
          strategy: {
            audience: 'Klientë lokalë',
            slots: [
              {
                day: now.getDate(),
                time: '18:00',
                channel: 'Instagram',
                topic: 'Rituali i kafesë',
                pillar: 'Produkt',
                intent: 'educate',
                hook: 'Një ritual i vogël me kuptim',
                purpose: 'Të tregojë produktin real në një moment të dobishëm.',
                assetDirection: 'Përdor fotografinë reale të kafesë.',
                visualLayout:
                  'Original photograph-specific direction built around the real subject and campaign intent.',
                algorithmGoal: 'saves',
                platformRationale: 'Instagrami e mbështet tregimin vizual të produktit.',
                timingRationale: 'Ora është hipotezë për testim me Insights.',
                factIds: ['f2'],
                sourceUrls: ['https://example.test/market'],
                requiredAssetId: assetId,
              },
            ],
            objective: 'Një muaj me ide për biznesin.',
            rationale: 'Postime që mbështeten te faktet e konfirmuara.',
          },
          research: {
            text: 'Kontekst lokal [1]',
            sources: [{ url: 'https://example.test/market', title: 'Burimi testues i tregut' }],
            citations: [
              {
                start: 15,
                end: 18,
                url: 'https://example.test/market',
                title: 'Burimi testues i tregut',
              },
            ],
            researchedAt: now.toISOString(),
          },
        },
      }
    else if (path === `/api/posts/${postId}/creative`) {
      const input = route.request().postDataJSON()
      expect(input).toMatchObject({ action: 'ai-edit', contentVersion: 1 })
      workspace.posts[0]!.contentVersion = 3
      aiEdited = true
      json = { business, image: `/api/media/${assetId}` }
    } else if (path === `/api/posts/${postId}/quality`) {
      if (route.request().method() === 'POST') {
        reviewedVersion = route.request().postDataJSON().contentVersion
        json = {
          contentVersion: reviewedVersion,
          fingerprint: 'fixture',
          quality: {
            decision: 'PASS',
            reasons: ['Versioni i redaktuar u rishikua.'],
            factuality: true,
            brandFit: true,
            visualQuality: true,
          },
        }
      } else
        json = {
          contentVersion: workspace.posts[0]!.contentVersion,
          quality: null,
          reviewedAt: null,
        }
    } else if (path.startsWith('/api/workspaces/'))
      return route.fulfill({ status: 409, json: { message: 'Unexpected automatic save in test' } })
    return route.fulfill({ json })
  })
  await page.goto(`/app/${id}/monthly-test/monthly-planner`)
  await expect(page.getByRole('heading', { name: 'Planifikimi me AI', exact: true })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole('heading', { name: 'Kalendari yt, i menduar përpara' })).toBeVisible({
    timeout: 15000,
  })
  await page.getByRole('button', { name: 'Shiko strategjinë dhe hulumtimin' }).click()
  await expect(page.locator('a[href="https://example.test/market"]').last()).toContainText(
    'Burimi testues i tregut',
  )
  await page.keyboard.press('Escape')
  await page.goto(`/app/${id}/monthly-test/calendar`)
  await expect(
    page.getByText('Rituali i kafesë', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible()
  await page.screenshot({ path: info.outputPath('monthly-calendar.png'), fullPage: true })
  await page.goto(`/app/${id}/monthly-test/content/${postId}`)
  await expect(page.getByRole('img', { name: 'Fotografia aktuale e postimit' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Zgjidh Fotografi tjetër nga galeria' })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Përmirëso me AI' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page
    .getByLabel('Çfarë dëshiron të ndryshosh?')
    .fill('Ruaje fotografinë aktuale dhe krijo atmosferë më editoriale.')
  await page.screenshot({ path: info.outputPath('creative-editor.png'), fullPage: true })
  await page.getByRole('button', { name: 'Krijo variantin me AI', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Përmirëso me AI' })).toBeEnabled()
  expect(aiEdited).toBe(true)
  await page.getByRole('button', { name: 'Pse ky postim?' }).click()
  await expect(page.getByRole('heading', { name: 'Dizajni' })).toBeVisible()
  await expect(page.getByText('#AurumRestaurant', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rishiko versionin aktual me AI' }).click()
  await expect(page.getByText('Rishikimi i versionit aktual u krye', { exact: true })).toBeVisible()
  expect(reviewedVersion).toBe(3)
  await page.screenshot({ path: info.outputPath('quality-review.png'), fullPage: true })
})

test('the user can require a gallery photo before monthly generation starts', async ({ page }) => {
  const id = randomUUID()
  const workspace = createDemo()
  workspace.posts = []
  workspace.assets = workspace.assets.slice(0, 2).map((asset) => ({
    ...asset,
    id: randomUUID(),
  }))
  const business = { id, slug: 'photo-choice-test', workspace }
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: workspace.preferences.timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
  let prepareBody: Record<string, unknown> | undefined
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/business')
      return route.fulfill({ json: { user: { name: 'Testuesi' }, business } })
    if (path === '/api/usage') return route.fulfill({ json: usageFixture })
    if (path === '/api/trial')
      return route.fulfill({
        json: { paid: true, state: 'active', limits: { posts_per_month: 12 } },
      })
    if (path === '/api/templates') return route.fulfill({ json: [] })
    if (path === '/api/meta/status') return route.fulfill({ json: { connection: null } })
    if (path === '/api/capabilities')
      return route.fulfill({ json: { ai: true, publishing: false } })
    if (path === '/api/ai/monthly-plan' && route.request().method() === 'POST') {
      prepareBody = route.request().postDataJSON()
      return route.fulfill({ status: 202, json: { id: randomUUID(), status: 'queued' } })
    }
    if (path === '/api/ai/monthly-plan')
      return route.fulfill({
        json: {
          month,
          configured: true,
          entitled: true,
          enabled: true,
          limit: 12,
          workerAlive: true,
          prerequisite: null,
          photoPreference: { configured: false, mode: 'auto', selectedAssetIds: [] },
          plan: null,
        },
      })
    return route.fulfill({ json: {} })
  })
  await page.goto(`/app/${id}/photo-choice-test/monthly-planner`)
  await page.getByRole('button', { name: /Dua të zgjedh foto/ }).click()
  await page.getByRole('button', { name: new RegExp(workspace.assets[0]!.name) }).click()
  await page.getByRole('button', { name: 'Përgatit këtë muaj' }).click()
  await expect.poll(() => prepareBody).toMatchObject({
    action: 'prepare',
    month,
    photoMode: 'selected',
    selectedAssetIds: [workspace.assets[0]!.id],
  })
})

test('a blocked quality review can restart, but existing drafts are preserved', async ({
  page,
}) => {
  const id = randomUUID()
  const workspace = createDemo()
  workspace.posts = []
  const business = { id, slug: 'restart-test', workspace }
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: workspace.preferences.timezone,
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
  let restartable = true
  let restartCalled = false
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/business')
      return route.fulfill({ json: { user: { name: 'Testuesi' }, business } })
    if (path === '/api/usage') return route.fulfill({ json: usageFixture })
    if (path === '/api/trial')
      return route.fulfill({
        json: { paid: true, state: 'active', limits: { posts_per_month: 30 } },
      })
    if (path === '/api/templates') return route.fulfill({ json: [] })
    if (path === '/api/meta/status') return route.fulfill({ json: { connection: null } })
    if (path === '/api/capabilities')
      return route.fulfill({ json: { ai: false, publishing: false } })
    if (path === '/api/ai/monthly-plan' && route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ action: 'restart', month })
      restartCalled = true
      restartable = false
      return route.fulfill({ status: 202, json: { id: randomUUID(), status: 'queued' } })
    }
    if (path === '/api/ai/monthly-plan')
      return route.fulfill({
        json: {
          month,
          configured: true,
          entitled: true,
          enabled: true,
          limit: 30,
          workerAlive: true,
          prerequisite: null,
          plan: {
            id: randomUUID(),
            status: 'blocked',
            stage: 'content',
            total: 30,
            completed: restartable ? 0 : 1,
            errorCode: 'QUALITY_BLOCKED',
            error: 'Kontrolli i cilësisë kërkon rishikim.',
            restartable,
            updatedAt: new Date().toISOString(),
            research: null,
            strategy: null,
          },
        },
      })
    return route.fulfill({ json: {} })
  })
  await page.goto(`/app/${id}/restart-test/monthly-planner`)
  await expect(
    page.getByRole('heading', { name: 'Dizajni kërkon rishikim' }),
  ).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByText('Asnjë', { exact: true })).toBeVisible()
  const restart = page.getByRole('button', { name: 'Vazhdo përgatitjen' })
  await expect(restart).toBeVisible({ timeout: 15000 })
  await restart.click()
  expect(restartCalled).toBe(true)
  await expect(restart).not.toBeVisible()
})
