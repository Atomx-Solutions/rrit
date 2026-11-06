import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { settleAbandonedRuns } from '../../server/utils/monthly-ai'

const now = new Date('2026-11-06T12:00:00Z')

type Run = { id: string; business_id: string; status: string; created_at: Date; retry_count: number; reserve_usage: string | null; image_call: boolean }

// A database with calls nobody returned to, the credits they reserved, and a
// balance and ledger the sweep writes to.
function fakeDatabase(runs: Run[], reservations: Record<string, number>, failing: string[] = []) {
  const asked: { sql: string; values: unknown[] }[] = []
  const statuses = new Map(runs.map((run) => [run.id, run.status]))
  const ledger: { key: string; event: string; usage: string }[] = Object.entries(reservations).map(([key]) => ({ key, event: 'reserve', usage: '' }))
  let reserved = Object.values(reservations).reduce((total, credits) => total + credits, 0)
  const client = {
    async query(sql: string, values: unknown[] = []) {
      asked.push({ sql, values })
      if (sql.includes('FROM monthly_ai_runs AS r')) return { rows: runs }
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql)) return { rows: [] }
      if (sql.startsWith('UPDATE monthly_ai_runs')) {
        if (failing.includes(String(values[1]))) throw new Error('lock timeout')
        if (statuses.get(String(values[1])) !== values[2]) return { rowCount: 0, rows: [] }
        statuses.set(String(values[1]), 'failed')
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes("metadata->>'credits' AS credits FROM credit_ledger")) {
        const credits = reservations[String(values[1])]
        return { rows: credits === undefined ? [] : [{ credits: String(credits) }] }
      }
      if (sql.startsWith('SELECT reserved_credits FROM credit_balances')) return { rows: [{ reserved_credits: reserved }] }
      if (sql.startsWith('INSERT INTO credit_balances')) return { rows: [] }
      if (sql.includes('FOR UPDATE'))
        return { rows: [{ remaining_credits: 1000, reserved_credits: reserved, period_start: null, period_end: null }] }
      if (sql.includes('INSERT INTO credit_ledger')) {
        ledger.push({ key: String(values[7]), event: String(values[2]), usage: String(values[3]) })
        return { rows: [{ id: 'ledger' }] }
      }
      if (sql.startsWith('UPDATE credit_balances')) {
        reserved += Number(values[2])
        return { rows: [{ remaining_credits: 1000, reserved_credits: reserved, period_start: null, period_end: null }] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  return { client: client as unknown as PoolClient, asked, ledger, statuses, reserved: () => reserved }
}

const old = new Date('2026-11-04T10:00:00Z')
const run = (id: string, extra: Partial<Run> = {}): Run => ({
  id, business_id: 'business-1', status: 'reserved', created_at: old, retry_count: 0, reserve_usage: 'generation', image_call: false, ...extra,
})

describe('AI calls nobody will return to', () => {
  it('are settled as interrupted and give back what they held, under the key of the call they made', async () => {
    const db = fakeDatabase(
      [run('text-1'), run('image-1', { image_call: true }), run('plan-1', { reserve_usage: 'research' })],
      { 'monthly-ai-credit-reserve:text-1': 15, 'monthly-image-credit-reserve:image-1': 143, 'monthly-ai-credit-reserve:plan-1': 18 },
    )
    await expect(settleAbandonedRuns(db.client, now)).resolves.toBe(3)
    expect([...db.statuses.values()]).toEqual(['failed', 'failed', 'failed'])
    expect(db.reserved()).toBe(0)
    const released = db.ledger.filter((entry) => entry.event === 'release')
    expect(released).toEqual([
      { key: 'monthly-ai-interrupted-release:text-1', event: 'release', usage: 'generation' },
      { key: 'monthly-image-interrupted-release:image-1', event: 'release', usage: 'generation' },
      { key: 'monthly-ai-interrupted-release:plan-1', event: 'release', usage: 'research' },
    ])
  })

  it('are looked for only once longer has passed than any call can run', async () => {
    const db = fakeDatabase([], {})
    await settleAbandonedRuns(db.client, now)
    const search = db.asked[0]!
    expect(search.sql).toContain("r.status IN ('reserved', 'uncertain')")
    // An image call may run 5 minutes and wait a minute for a busy provider,
    // and its answer takes up to a minute more to be written.
    expect(search.values[0]).toEqual(new Date(now.getTime() - (300 + 60 + 60) * 1000))
  })

  it('leave the others to go ahead when one of them cannot be settled now', async () => {
    const db = fakeDatabase(
      [run('stuck-1'), run('text-2')],
      { 'monthly-ai-credit-reserve:stuck-1': 10, 'monthly-ai-credit-reserve:text-2': 20 },
      ['stuck-1'],
    )
    await expect(settleAbandonedRuns(db.client, now)).resolves.toBe(1)
    expect(db.statuses.get('stuck-1')).toBe('reserved')
    expect(db.statuses.get('text-2')).toBe('failed')
    expect(db.asked.some((entry) => entry.sql === 'ROLLBACK TO SAVEPOINT abandoned_run')).toBe(true)
  })
})
