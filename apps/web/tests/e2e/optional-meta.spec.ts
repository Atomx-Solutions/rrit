import { test, expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { Post, Workspace } from '../../shared/schemas/workspace'
import { signUp } from './helpers/auth'

async function business(request: APIRequestContext) {
  const response = await request.get('/api/business')
  expect(response.status()).toBe(200)
  return (await response.json()).business as { id: string; slug: string; workspace: Workspace }
}

test('approve and plan both channels without Meta; publication remains explicit', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120000)
  const origin = new URL(baseURL!).origin
  const headers = { Origin: origin }
  await signUp(page, 'Test kalendari')
  const created = await page.request.post('/api/business', {
    headers,
    data: {
      name: 'Kalendari pa Meta',
      city: 'Prishtinë',
      industry: 'Dyqan',
      description: 'Produkte të punuara me dorë për klientët tanë.',
      voice: 'Thjesht',
    },
  })
  expect(created.status()).toBe(201)
  const initial = await business(page.request)
  const base = `/app/${initial.id}/${initial.slug}`
  const meta = await (await page.request.get('/api/meta/status')).json()
  expect(meta.connection).toBeNull()
  const imageId = randomUUID()
  const photo = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#739276' },
  })
    .jpeg()
    .toBuffer()
  const draft: Post = {
    id: randomUUID(),
    title: 'Postimi për Facebook',
    caption: 'Produkti ynë i punuar me kujdes.',
    channel: 'Facebook',
    format: 'static',
    image: `/api/media/${imageId}`,
    pillar: 'Produkti',
    status: 'draft',
    scheduledAt: null,
    version: 1,
    history: [],
    policy: 'warn',
    policyReason: '',
  }
  const input = structuredClone(initial.workspace)
  input.revision++
  input.onboarding = 3
  input.assets.push({
    id: imageId,
    name: 'Produkti',
    url: 'data:image/jpeg;base64,' + photo.toString('base64'),
    rights: true,
    tags: [],
    kind: 'photo',
    size: photo.length,
  })
  input.posts.push(draft, {
    ...draft,
    id: randomUUID(),
    title: 'Postimi për Instagram',
    channel: 'Instagram',
  })
  const inserted = await page.request.put(`/api/workspaces/${initial.id}`, { headers, data: input })
  expect(inserted.status()).toBe(200)
  const ids = input.posts.map((post) => post.id)

  for (const id of ids) {
    // Provider failure must not mark valid content as blocked or prevent its approval.
    const publicationCheck = await page.request.post(`/api/posts/${id}/validate`, {
      headers,
      data: { scope: 'publication' },
    })
    expect(publicationCheck.status()).toBe(200)
    expect((await publicationCheck.json()).passed).toBe(false)
    expect(
      (await business(page.request)).workspace.posts.find((post) => post.id === id)?.policy,
    ).toBe('pass')
    const contentCheck = await page.request.post(`/api/posts/${id}/validate`, { headers, data: {} })
    const content = await contentCheck.json()
    expect(content).toMatchObject({ scope: 'content', passed: true })
    expect(content.checks.some((check: { key: string }) => check.key.startsWith('meta'))).toBe(
      false,
    )

    await page.goto(base + '/content/' + id)
    await page.getByRole('button', { name: 'Dërgo për miratim', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mirato postimin', exact: true })).toBeDisabled()
    await page
      .getByRole('checkbox', {
        name: 'I kontrollova faktet, çmimet, datat dhe të drejtat e fotografisë.',
      })
      .check()
    await page.getByRole('button', { name: 'Mirato postimin', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Planifiko postimin', exact: true }),
    ).toBeVisible()
    const approved = (await business(page.request)).workspace
    expect(approved.posts.find((post) => post.id === id)?.status).toBe('approved')

    // Calling the APIs directly cannot turn a local content check into publishing permission.
    const automatic = structuredClone(approved)
    automatic.revision++
    const automaticPost = automatic.posts.find((post) => post.id === id)!
    automaticPost.status = 'scheduled'
    automaticPost.publicationMode = 'automatic'
    automaticPost.scheduledAt = new Date(Date.now() + 3600000).toISOString()
    const denied = await page.request.put(`/api/workspaces/${initial.id}`, {
      headers,
      data: automatic,
    })
    expect(denied.status()).toBe(422)
    const publish = await page.request.post(`/api/posts/${id}/publish`, {
      headers,
      data: { confirmed: true, version: automaticPost.version },
    })
    expect([422, 503]).toContain(publish.status())

    await page.getByRole('button', { name: 'Planifiko postimin', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Shto në kalendar', exact: true })
    const toggle = dialog.getByRole('checkbox', { name: 'Publiko automatikisht në këtë orar' })
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeDisabled()
    // A calendar date beyond the trial is allowed; it is not a publishing job.
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + 'T11:00'
    await dialog.getByLabel('Data dhe ora', { exact: true }).fill(future)
    await dialog.getByRole('button', { name: 'Konfirmo orarin', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.reload()
    await expect(page.getByText('Ruajtur vetëm në kalendar', { exact: true })).toBeVisible()
    const scheduled = (await business(page.request)).workspace.posts.find((post) => post.id === id)!
    expect(scheduled).toMatchObject({ status: 'scheduled', publicationMode: 'manual' })
    const trial = await (await page.request.get('/api/trial')).json()
    expect(Date.parse(scheduled.scheduledAt!)).toBeGreaterThan(Date.parse(trial.expiresAt))
    expect(await (await page.request.get(`/api/posts/${id}/publication`)).json()).toEqual({
      job: null,
    })
  }

  // Disconnecting must retain manual schedules and local validation records.
  expect((await page.request.post('/api/meta/disconnect', { headers, data: {} })).status()).toBe(
    200,
  )
  const afterDisconnect = (await business(page.request)).workspace
  expect(
    afterDisconnect.posts.every(
      (post) => post.status === 'scheduled' && post.publicationMode === 'manual',
    ),
  ).toBe(true)
  await page.goto(base + '/calendar')
  const futureMonth = new Date(Date.now() + 7 * 86400000).getMonth()
  if (futureMonth !== new Date().getMonth())
    await page.getByRole('button', { name: 'Muaji i ardhshëm' }).click()
  await expect(page.getByRole('link', { name: /^Postimi për Facebook/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Postimi për Instagram/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  // Content safeguards remain enforced without Meta.
  const invalid = structuredClone(afterDisconnect)
  invalid.revision++
  const invalidPost = { ...draft, id: randomUUID(), caption: 'Oferta kushton [çmimi].' }
  invalid.posts.push(invalidPost)
  expect(
    (await page.request.put(`/api/workspaces/${initial.id}`, { headers, data: invalid })).status(),
  ).toBe(200)
  const invalidCheck = await (
    await page.request.post(`/api/posts/${invalidPost.id}/validate`, {
      headers,
      data: { scope: 'content' },
    })
  ).json()
  expect(invalidCheck.passed).toBe(false)
  expect(
    invalidCheck.checks.find((check: { key: string }) => check.key === 'placeholders').passed,
  ).toBe(false)

  const withdrawn = await page.request.post(`/api/media/${imageId}/rights`, {
    headers,
    data: { rights: false, confirmed: true },
  })
  expect(withdrawn.status()).toBe(200)
  expect(await withdrawn.json()).toMatchObject({ withdrawn: true, inFlight: 0 })
  const afterWithdrawal = (await business(page.request)).workspace
  expect(afterWithdrawal.assets.find((asset) => asset.id === imageId)?.rights).toBe(false)
  expect(
    afterWithdrawal.posts
      .filter((post) => post.image === `/api/media/${imageId}`)
      .every(
        (post) =>
          post.status === 'draft' &&
          post.policy === 'block' &&
          post.scheduledAt === null &&
          post.publicationMode === 'manual',
      ),
  ).toBe(true)
})
