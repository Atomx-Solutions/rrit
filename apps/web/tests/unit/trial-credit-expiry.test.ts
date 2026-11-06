import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { expireEndedTrialCredits } from '../../server/utils/trials'

const trialStart = new Date('2026-11-01T10:00:00Z')

// A database with the trials that ended and still hold credits, and the
// balances and ledger the expiry writes to.
function fakeDatabase(ended: { organization_id: string; remaining: number }[]) {
  const asked: string[] = []
  const ledger: { key: string; event: string; delta: number }[] = []
  const balances = new Map(ended.map((row) => [row.organization_id, row.remaining]))
  const client = {
    async query(sql: string, values: unknown[] = []) {
      asked.push(sql)
      if (sql.includes('FROM credit_balances AS b'))
        return { rows: ended.map((row) => ({ organization_id: row.organization_id, period_start: trialStart })) }
      if (sql.startsWith('INSERT INTO credit_balances')) return { rows: [] }
      if (sql.includes('FROM credit_balances WHERE organization_id=$1 FOR UPDATE')) {
        const remaining = balances.get(String(values[0])) || 0
        return { rows: [{ remaining_credits: remaining, reserved_credits: 0, period_start: trialStart, period_end: null }] }
      }
      if (sql.includes('INSERT INTO credit_ledger')) {
        const key = String(values[7])
        if (ledger.some((entry) => entry.key === key)) return { rows: [] }
        ledger.push({ key, event: String(values[2]), delta: Number(values[4]) })
        return { rows: [{ id: 'ledger' }] }
      }
      if (sql.includes('UPDATE credit_balances SET remaining_credits=0')) {
        balances.set(String(values[0]), 0)
        return { rows: [{ remaining_credits: 0, reserved_credits: 0, period_start: trialStart, period_end: null }] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  return { client: client as unknown as PoolClient, asked, ledger, balances }
}

describe('credits a trial left unused', () => {
  it('end once the trial is over, as a package’s do, with a record of what ended', async () => {
    const db = fakeDatabase([{ organization_id: 'business-1', remaining: 240 }])
    await expect(expireEndedTrialCredits(db.client)).resolves.toBe(1)
    expect(db.balances.get('business-1')).toBe(0)
    expect(db.ledger).toEqual([
      { key: `trial-ended:business-1:${trialStart.toISOString()}`, event: 'expire', delta: -240 },
    ])
  })

  it('end only once however often the round runs', async () => {
    const db = fakeDatabase([{ organization_id: 'business-1', remaining: 240 }])
    await expireEndedTrialCredits(db.client)
    await expireEndedTrialCredits(db.client)
    expect(db.ledger.filter((entry) => entry.event === 'expire')).toHaveLength(1)
  })

  it('are looked for only where the trial is over and nothing paid has taken over', async () => {
    const db = fakeDatabase([])
    await expect(expireEndedTrialCredits(db.client)).resolves.toBe(0)
    const search = db.asked[0]!
    // The balance must be the trial's own period, ended, and not covered by a
    // package or an entitlement in force.
    expect(search).toContain("date_trunc('milliseconds', b.period_start) = date_trunc('milliseconds', g.starts_at)")
    expect(search).toContain('g.expires_at <= $1')
    expect(search).toContain('FROM custom_packages')
    // A package credits the balance before it starts, so one not yet started
    // protects it too, and any other credit added since the trial does.
    expect(search).not.toContain('p.starts_at <= $1')
    expect(search).toContain('FROM credit_ledger AS l')
    expect(search).toContain("l.event_type IN ('grant', 'adjustment', 'refund')")
    expect(search).toContain('FROM entitlements')
    expect(search).toContain('b.remaining_credits > 0')
  })
})
