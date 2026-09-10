import { expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export type E2EAccount = {
  email: string
  password: string
}

export async function signUp(page: Page, name: string): Promise<E2EAccount> {
  const account = {
    email: `rrit-e2e-${randomUUID()}@example.test`,
    password: `Test-only-${randomUUID()}`,
  }

  await page.goto('/signup')
  await page.locator('input[autocomplete="name"]').fill(name)
  await page.locator('input[autocomplete="email"]').fill(account.email)
  await page.locator('input[autocomplete="new-password"]').fill(account.password)
  await page.locator('form button[type="submit"]').click()

  let destination: string
  try {
    await expect
      .poll(
        async () => {
          const pathname = new URL(page.url()).pathname
          if (pathname === '/onboarding' || pathname === '/verify-email') return pathname
          return (await page.locator('[role="alert"]').count()) ? 'error' : 'pending'
        },
        { timeout: 10000 },
      )
      .toMatch(/^\/(?:onboarding|verify-email)$|^error$/)
    destination = new URL(page.url()).pathname
  } catch (error) {
    if (new URL(page.url()).pathname !== '/signup') throw error
    destination = '/signup'
  }

  if (destination === '/verify-email') {
    await confirmE2EAccount(account.email)
  } else if (destination === '/signup') {
    const alert = page.locator('[role="alert"]').first()
    const message = (await alert.count()) ? await alert.innerText() : ''
    if (message && !message.includes('Ke provuar disa herë')) throw new Error(message)
    await ensureE2EAccount(account, name)

    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByLabel('Fjalëkalimi', { exact: true }).fill(account.password)
    await page.getByRole('button', { name: 'Hyr në llogari', exact: true }).click()
  }

  await expect(page, 'E2E account must reach onboarding after signup.').toHaveURL(
    /\/onboarding(?:\?.*)?$/,
    { timeout: 30000 },
  )

  return account
}

export async function signOut(page: Page) {
  const account = page.getByRole('button', { name: 'Llogaria ime', exact: true })
  if (await account.count()) {
    await account.click()
    await page.getByRole('menuitem', { name: 'Dil nga llogaria', exact: true }).click()
  } else {
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())
    await page.goto('/login')
  }
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/, { timeout: 15000 })
}

function adminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for E2E cleanup.')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function confirmE2EAccount(email: string) {
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) throw new Error('Supabase Auth did not create the E2E account.')
  const confirmed = await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
  if (confirmed.error) throw confirmed.error
}

async function ensureE2EAccount(account: E2EAccount, name: string) {
  const admin = adminClient()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  const existing = listed.data.users.find((candidate) => candidate.email === account.email)
  if (existing) return confirmE2EAccount(account.email)

  const created = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { name },
  })
  if (!created.error) return
  if (!created.error.message.toLowerCase().includes('already')) throw created.error
  await confirmE2EAccount(account.email)
}

export async function deleteAccount(email: string) {
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) return
  const result = await admin.auth.admin.deleteUser(user.id)
  if (result.error) throw result.error
}
