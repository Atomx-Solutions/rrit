import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimSocialTrialIdentities } from '../../server/utils/trials'

beforeEach(() => {
  vi.stubEnv('TRIAL_HASH_KEY', 'test-trial-hash-key-with-at-least-32-chars')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const newBusiness = '00000000-0000-4000-8000-000000000002'
const trialOwner = '00000000-0000-4000-8000-000000000001'

function claimClient(pageAlreadyUsed: boolean) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT status FROM trial_grants')) return { rows: [{ status: 'granted' }] }
    if (sql.startsWith('INSERT INTO trial_claims'))
      return { rows: pageAlreadyUsed ? [] : [{ business_id: newBusiness }], rowCount: 1 }
    if (sql.startsWith('SELECT business_id FROM trial_claims'))
      return { rows: [{ business_id: trialOwner }] }
    if (sql.includes('UPDATE trial_grants')) return { rows: [{ business_id: newBusiness }], rowCount: 1 }
    if (sql.includes('UPDATE subscriptions')) return { rows: [{ id: 'trial-subscription' }] }
    if (sql.includes('FROM credit_balances') || sql.startsWith('UPDATE credit_balances'))
      return {
        rows: [
          {
            research_remaining_credits: 125,
            research_reserved_credits: 0,
            generation_remaining_credits: 125,
            generation_reserved_credits: 0,
            period_start: null,
            period_end: null,
          },
        ],
      }
    if (sql.includes('INSERT INTO credit_ledger')) return { rows: [{ id: 'ledger' }] }
    return { rows: [], rowCount: 0 }
  })
  return { query }
}

describe('trial abuse protection', () => {
  it('revokes the trial, its subscription and its credits when the Meta page already used a trial', async () => {
    const client = claimClient(true)
    await claimSocialTrialIdentities(client as never, newBusiness, [
      { kind: 'facebook_page', value: '113047871855212' },
    ])
    const statements = client.query.mock.calls.map(([sql]) => String(sql))
    expect(statements.some((sql) => sql.includes("SET status = 'revoked'"))).toBe(true)
    expect(statements.some((sql) => sql.includes("SET status='cancelled'"))).toBe(true)
    expect(
      client.query.mock.calls.some(
        ([sql, values]) =>
          String(sql).includes('INSERT INTO credit_ledger') && (values as unknown[])[2] === 'expire',
      ),
    ).toBe(true)
  })

  it('keeps the trial of a Meta page that has never used one', async () => {
    const client = claimClient(false)
    await claimSocialTrialIdentities(client as never, newBusiness, [
      { kind: 'facebook_page', value: '999999999' },
    ])
    const statements = client.query.mock.calls.map(([sql]) => String(sql))
    expect(statements.some((sql) => sql.includes('UPDATE trial_grants'))).toBe(false)
    expect(statements.some((sql) => sql.includes('UPDATE subscriptions'))).toBe(false)
  })
})
