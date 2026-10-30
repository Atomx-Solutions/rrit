import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A client once activated a draft offer without paying. The migration cannot
// run without a database, so its guarantees are asserted against its text.
const sql = readFileSync(
  new URL('../../database/migrations/20261030130000_client_cannot_accept_unpaid_package.sql', import.meta.url),
  'utf8',
)

describe('client package offers', () => {
  it('removes the function that let a client accept an offer', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.client_decide_custom_package_proposal(boolean);')
  })

  it('lets the client only cancel the draft offer', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.client_decline_custom_package_proposal'))
    expect(body).toContain("SET status = 'cancelled'")
    expect(body).not.toMatch(/status\s*=\s*'(active|merged)'/)
    expect(body).not.toContain('credit_grant')
  })

  it('grants the decline to the app runtime only', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.client_decline_custom_package_proposal() FROM PUBLIC;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.client_decline_custom_package_proposal() TO app_runtime;')
  })

  it('serves no accept endpoint to clients', () => {
    expect(existsSync(new URL('../../server/api/billing/custom-package-accept.post.ts', import.meta.url))).toBe(false)
  })
})
