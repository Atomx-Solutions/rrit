import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { deleteAccount, signUp } from './helpers/auth'
import type { Workspace } from '../../shared/schemas/workspace'

async function createBusiness(request: APIRequestContext, origin: string) {
  const response = await request.post('/api/business', {
    headers: { Origin: origin },
    data: {
      name: `PRC-07 ${randomUUID().slice(0, 8)}`,
      city: 'Prishtinë',
      industry: 'Shërbime',
      description: 'Shërbime reale për klientët e biznesit tonë.',
      voice: 'E qartë dhe miqësore',
    },
  })
  const body = await response.text()
  expect(response.status(), body).toBe(201)
  return JSON.parse(body) as { id: string; slug: string }
}

function draft(index: number) {
  return {
    id: randomUUID(),
    title: `Postimi trial ${index}`,
    caption: `Përmbajtja e postimit trial ${index}.`,
    status: 'draft' as const,
    channel: 'Instagram' as const,
    format: 'static' as const,
    image: '',
    pillar: 'Produkti',
    scheduledAt: null,
    version: 1,
    history: [],
    policy: 'warn' as const,
    policyReason: 'Test PRC-07',
    contentVersion: 1,
  }
}

test('PRC-07 blocks the fourth trial post', async ({ page }) => {
  test.setTimeout(90000)
  const account = await signUp(page, 'PRC-07 Trial')
  try {
    // The app validates Origin against APP_URL, which points to the shared
    // Supabase-backed environment for this remote E2E run.
    const origin = new URL(process.env.APP_URL || page.url()).origin
    const created = await createBusiness(page.request, origin)
    const currentResponse = await page.request.get('/api/business')
    expect(currentResponse.status()).toBe(200)
    const current = (await currentResponse.json()).business as {
      id: string
      slug: string
      workspace: Workspace
    }
    expect(current.id).toBe(created.id)

    const trialResponse = await page.request.get('/api/trial')
    expect(trialResponse.status()).toBe(200)
    const trial = await trialResponse.json()
    expect(trial.state).toBe('active')
    expect(trial.paid).toBe(false)
    expect(trial.limits.posts_per_month).toBe(3)

    const workspace = structuredClone(current.workspace)
    workspace.revision++
    workspace.posts.push(draft(1), draft(2), draft(3))
    const saved = await page.request.put(`/api/workspaces/${created.id}`, {
      headers: { Origin: origin },
      data: workspace,
    })
    expect(saved.status()).toBe(200)

    const usage = await page.request.get('/api/usage')
    expect(usage.status()).toBe(200)
    expect((await usage.json()).usage.posts_per_month).toEqual({ current: 3, limit: 3 })

    const fourth = structuredClone(workspace)
    fourth.revision++
    fourth.posts.push(draft(4))
    const blocked = await page.request.put(`/api/workspaces/${created.id}`, {
      headers: { Origin: origin },
      data: fourth,
    })
    expect(blocked.status()).toBe(402)
    expect(await blocked.json()).toMatchObject({
      data: { code: 'QUOTA_EXCEEDED', quota: 'posts_per_month', current: 3, limit: 3 },
    })
  } finally {
    await deleteAccount(account.email)
  }
})
