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

  await expect(
    page,
    'Supabase Auth must return a session for E2E accounts; disable email confirmation in the staging project.',
  ).toHaveURL(/\/onboarding(?:\?.*)?$/, { timeout: 30000 })

  return account
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Llogaria ime', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Dil nga llogaria', exact: true }).click()
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/, { timeout: 15000 })
}

function adminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for E2E cleanup.')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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
