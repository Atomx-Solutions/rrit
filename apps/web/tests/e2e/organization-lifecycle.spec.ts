import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { deleteAccount, signUp, type E2EAccount } from './helpers/auth'

type Organization = {
  id: string
  name: string
  slug: string
  revision: number
  role: string
}

function serviceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service credentials are required for organization E2E.')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function revokeMembership(email: string, organizationId: string) {
  const admin = serviceClient()
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (users.error) throw users.error
  const user = users.data.users.find((candidate) => candidate.email === email)
  if (!user) throw new Error('E2E user was not found for membership cleanup.')
  const result = await admin
    .from('organization_memberships')
    .update({ status: 'suspended' })
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
  if (result.error) throw result.error
}

async function addSecondaryOwner(organizationId: string) {
  const admin = serviceClient()
  const email = `rrit-e2e-member-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  const created = await admin.auth.admin.createUser({
    email,
    password: `Test-only-${Date.now()}-Aa1!`,
    email_confirm: true,
  })
  if (created.error || !created.data.user) throw created.error || new Error('Could not create E2E member.')
  const ownerMembership = await admin.from('organization_memberships').insert({
    organization_id: organizationId,
    user_id: created.data.user.id,
    role: 'owner',
    brand_scope: 'ALL_BRANDS',
    status: 'active',
  })
  if (ownerMembership.error) throw ownerMembership.error
  const ownerChange = await admin
    .from('organizations')
    .update({ created_by: created.data.user.id })
    .eq('id', organizationId)
  if (ownerChange.error) throw ownerChange.error
  return created.data.user.id
}

async function createOrganization(page: Parameters<typeof signUp>[0], name: string, slug: string) {
  const origin = new URL(page.url()).origin
  const response = await page.request.post('/api/v1/organizations', {
    headers: { origin, referer: `${origin}/organizations` },
    data: { name, slug },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as Organization
}

async function cleanup(account: E2EAccount | undefined) {
  if (!account) return
  try {
    await deleteAccount(account.email)
  } catch (problem) {
    // Organization owner FKs intentionally prevent auth-user deletion in a shared
    // project. Cleanup failure must not hide the lifecycle assertion result.
    const message = problem instanceof Error ? problem.message : String(problem)
    console.warn(`Could not delete E2E account ${account.email}: ${message}`)
  }
}

test.describe('organization lifecycle', () => {
  test('shows the first-organization empty state and creates an organization', async ({ page }) => {
    let account: E2EAccount | undefined
    try {
      account = await signUp(page, 'Organization Lifecycle')
      await page.goto('/organizations')
      await expect(page.getByTestId('organization-empty-state')).toBeVisible()
      const slug = `lifecycle-organization-${Date.now()}`
      await page.getByTestId('organization-name').fill('Lifecycle Organization')
      await page.getByTestId('organization-slug').fill(slug)
      await page.getByTestId('organization-create').click()
      await expect(page.getByTestId('organization-list')).toContainText('Lifecycle Organization')
      await expect(page.getByText('Aktive')).toBeVisible()
    } finally {
      await cleanup(account)
    }
  })

  test('switches between valid organizations and restores the selection after refresh', async ({ page }) => {
    let account: E2EAccount | undefined
    try {
      account = await signUp(page, 'Organization Switcher')
      const first = await createOrganization(page, 'Switcher Alpha', `switcher-alpha-${Date.now()}`)
      const second = await createOrganization(page, 'Switcher Beta', `switcher-beta-${Date.now()}`)
      await page.goto('/organizations')
      await expect(page.getByTestId(`organization-option-${first.id}`)).toBeVisible()
      await page.getByTestId(`organization-option-${second.id}`).click()
      await expect(page.getByTestId(`organization-option-${second.id}`)).toContainText('Aktive')
      await page.reload()
      await expect(page.getByTestId(`organization-option-${second.id}`)).toContainText('Aktive')
    } finally {
      await cleanup(account)
    }
  })

  test('clears a removed membership and rejects a tampered persisted ID', async ({ page }) => {
    let account: E2EAccount | undefined
    let secondaryUserId: string | undefined
    let sharedOrganizationId: string | undefined
    try {
      account = await signUp(page, 'Organization Safety')
      const first = await createOrganization(page, 'Safety Alpha', `safety-alpha-${Date.now()}`)
      const fallback = await createOrganization(page, 'Safety Fallback', `safety-fallback-${Date.now()}`)
      sharedOrganizationId = first.id
      secondaryUserId = await addSecondaryOwner(sharedOrganizationId)
      await page.goto('/organizations')
      await page.getByTestId(`organization-option-${sharedOrganizationId}`).click()
      await page.context().addCookies([
        {
          name: 'rrit-active-organization',
          value: '00000000-0000-4000-8000-000000000000',
          url: new URL(page.url()).origin,
        },
      ])
      await page.reload()
      await expect(page.getByTestId(`organization-option-${first.id}`)).toContainText('Aktive')
      await expect(page.getByTestId('organization-list')).not.toContainText('00000000-0000-4000-8000-000000000000')
      await page.getByTestId(`organization-option-${sharedOrganizationId}`).click()
      await revokeMembership(account.email, sharedOrganizationId)
      await page.reload()
      await expect(page.getByTestId(`organization-option-${sharedOrganizationId}`)).toBeHidden()
      await expect(page.getByTestId(`organization-option-${fallback.id}`)).toBeVisible()
    } finally {
      await cleanup(account)
      if (secondaryUserId) {
        const admin = serviceClient()
        try {
          await admin.auth.admin.deleteUser(secondaryUserId)
        } catch (problem) {
          console.warn(`Could not delete E2E secondary member: ${String(problem)}`)
        }
      }
    }
  })
})
