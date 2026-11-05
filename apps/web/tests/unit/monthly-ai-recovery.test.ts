import type { PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  attemptKey,
  callSettleMarginMs,
  interruptedRunCode,
  settleInterruptedRun,
} from '../../server/utils/monthly-ai-recovery'
import { recoverPriorRun } from '../../server/utils/monthly-ai'

const businessId = '00000000-0000-4000-8000-000000000001'
const timeoutMs = 180000
const now = Date.parse('2026-11-05T10:00:00Z')
const stale = new Date(now - timeoutMs - callSettleMarginMs - 1000)
const young = new Date(now - 30000)

type Run = Record<string, unknown> & { id: string; status: string }

// A database of one business: its runs, its credit ledger and its balance.
function fakeDatabase(options: {
  run: Run
  reservations?: { key: string; credits?: number }[]
  reserved?: number
  providerCostPerCredit?: number
}) {
  const runs = new Map([[options.run.id, { ...options.run }]])
  const ledger = (options.reservations || []).map((item) => ({
    key: item.key,
    event: 'reserve',
    metadata: item.credits === undefined ? {} : { credits: item.credits },
  }))
  const balance = { remaining: 1000, reserved: options.reserved ?? 0 }
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.startsWith('UPDATE monthly_ai_runs')) {
        const run = runs.get(String(values[1]))
        if (!run || run.status !== values[2]) return { rowCount: 0, rows: [] }
        run.status = 'failed'
        run.error_code = values[0]
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes("metadata->>'credits' AS credits FROM credit_ledger")) {
        const found = ledger.find((entry) => entry.key === values[1] && entry.event === 'reserve')
        const credits = (found?.metadata as { credits?: number } | undefined)?.credits
        return { rowCount: found ? 1 : 0, rows: found ? [{ credits: credits === undefined ? null : String(credits) }] : [] }
      }
      if (sql.startsWith('SELECT reserved_credits FROM credit_balances'))
        return { rowCount: 1, rows: [{ reserved_credits: balance.reserved }] }
      if (sql.startsWith('INSERT INTO credit_balances')) return { rowCount: 0, rows: [] }
      if (sql.includes('FROM credit_balances WHERE organization_id=$1 FOR UPDATE'))
        return { rowCount: 1, rows: [{ remaining_credits: balance.remaining, reserved_credits: balance.reserved, period_start: null, period_end: null }] }
      if (sql.includes('INSERT INTO credit_ledger')) {
        if (ledger.some((entry) => entry.key === values[7])) return { rowCount: 0, rows: [] }
        ledger.push({ key: String(values[7]), event: String(values[2]), metadata: {} })
        return { rowCount: 1, rows: [{ id: 'ledger' }] }
      }
      if (sql.startsWith('UPDATE credit_balances')) {
        balance.remaining += Number(values[1])
        balance.reserved += Number(values[2])
        return { rowCount: 1, rows: [{ remaining_credits: balance.remaining, reserved_credits: balance.reserved, period_start: null, period_end: null }] }
      }
      if (sql.includes('FROM credit_pricing'))
        return { rowCount: 1, rows: [{ credit_price_cents: 10, provider_cost_per_credit_micro_eur: options.providerCostPerCredit ?? 1000 }] }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  return { client, runs, ledger, balance }
}

// The fake answers only the queries this code makes, not pg's every overload.
const settle = (client: ReturnType<typeof fakeDatabase>['client'], run: Run) =>
  settleInterruptedRun(client as unknown as Pick<PoolClient, 'query'>, run, {
    businessId,
    callTimeoutMs: timeoutMs,
    reserveKeyPrefix: 'monthly-image-credit-reserve',
    releaseKeyPrefix: 'monthly-image-interrupted-release',
    usageKind: 'generation',
    now,
  })

describe('a stage whose call was cut off', () => {
  it('marks a run left reserved past its call as interrupted and returns the credits it held', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: stale, retry_count: 0 }
    const db = fakeDatabase({ run, reservations: [{ key: 'monthly-image-credit-reserve:run-1', credits: 40 }], reserved: 40 })
    const settled = await settle(db.client, run)
    expect(settled).toMatchObject({ status: 'failed', error_code: interruptedRunCode })
    expect(db.runs.get('run-1')).toMatchObject({ status: 'failed', error_code: interruptedRunCode })
    expect(db.balance.reserved).toBe(0)
    expect(db.ledger.map((entry) => entry.key)).toContain('monthly-image-interrupted-release:run-1')
  })

  it('waits for a run reserved too recently to know whether its call still runs', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: young, retry_count: 0 }
    const db = fakeDatabase({ run, reservations: [{ key: 'monthly-image-credit-reserve:run-1', credits: 40 }], reserved: 40 })
    await expect(settle(db.client, run)).rejects.toMatchObject({ code: 'PROVIDER_TEMPORARY' })
    expect(db.runs.get('run-1')!.status).toBe('reserved')
    expect(db.balance.reserved).toBe(40)
  })

  it('settles a run whose answer was lost on the way back at once', async () => {
    const run = { id: 'run-1', status: 'uncertain', created_at: young, retry_count: 0 }
    const db = fakeDatabase({ run, reservations: [{ key: 'monthly-image-credit-reserve:run-1', credits: 40 }], reserved: 40 })
    await expect(settle(db.client, run)).resolves.toMatchObject({ status: 'failed', error_code: interruptedRunCode })
    expect(db.balance.reserved).toBe(0)
  })

  it('returns only what a later attempt itself reserved, under that attempt’s keys', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: stale, retry_count: 2 }
    const db = fakeDatabase({
      run,
      reservations: [
        { key: 'monthly-image-credit-reserve:run-1', credits: 40 },
        { key: 'monthly-image-credit-reserve:run-1:2', credits: 25 },
      ],
      reserved: 30,
    })
    await settle(db.client, run)
    expect(db.balance.reserved).toBe(5)
    expect(db.ledger.map((entry) => entry.key)).toContain('monthly-image-interrupted-release:run-1:2')
  })

  it('works out a reservation stored without its size from the run’s reserved cost', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: stale, retry_count: 0, reserved_cost_micro_eur: '12500' }
    const db = fakeDatabase({ run, reservations: [{ key: 'monthly-image-credit-reserve:run-1' }], reserved: 50 })
    await settle(db.client, run)
    // 12500 micro-euro at 1000 per credit is 13 credits.
    expect(db.balance.reserved).toBe(37)
  })

  it('never returns more than the balance still holds, as after a new credit period', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: stale, retry_count: 0 }
    const db = fakeDatabase({ run, reservations: [{ key: 'monthly-image-credit-reserve:run-1', credits: 40 }], reserved: 0 })
    await settle(db.client, run)
    expect(db.balance.reserved).toBe(0)
    expect(db.ledger.map((entry) => entry.key)).not.toContain('monthly-image-interrupted-release:run-1')
  })

  it('returns nothing for a platform cost, which reserved nothing from the business', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: stale, retry_count: 0 }
    const db = fakeDatabase({ run, reserved: 10 })
    await expect(settle(db.client, run)).resolves.toMatchObject({ status: 'failed' })
    expect(db.balance.reserved).toBe(10)
  })

  it('leaves a run another step settled first for that step', async () => {
    const run = { id: 'run-1', status: 'reserved', created_at: stale, retry_count: 0 }
    const db = fakeDatabase({ run: { ...run, status: 'failed' } })
    await expect(settle(db.client, run)).rejects.toMatchObject({ code: 'PROVIDER_TEMPORARY' })
  })

  it('leaves completed and failed runs as they are', async () => {
    for (const status of ['completed', 'failed']) {
      const run = { id: 'run-1', status, created_at: stale, retry_count: 0 }
      const db = fakeDatabase({ run })
      await expect(settle(db.client, run)).resolves.toBe(run)
      expect(db.runs.get('run-1')!.status).toBe(status)
    }
    await expect(settle(fakeDatabase({ run: { id: 'run-1', status: 'failed' } }).client, undefined as unknown as Run)).resolves.toBeUndefined()
  })
})

describe('calling an interrupted stage again', () => {
  it('calls it again while attempts remain and stops after the bound', async () => {
    const interrupted = { id: 'run-1', status: 'failed', error_code: interruptedRunCode }
    await expect(recoverPriorRun({ ...interrupted, retry_count: 0 })).resolves.toMatchObject({ id: 'run-1' })
    await expect(recoverPriorRun({ ...interrupted, retry_count: 3 })).rejects.toMatchObject({ code: 'PROVIDER_RETRY_EXHAUSTED' })
  })

  it('still never calls again a run that was not settled', async () => {
    await expect(recoverPriorRun({ id: 'run-1', status: 'reserved' })).rejects.toMatchObject({ code: 'PROVIDER_RETRY_EXHAUSTED' })
  })

  it('gives each later attempt credit keys of its own and keeps the first attempt’s keys', () => {
    expect(attemptKey('monthly-ai-credit-reserve', 'run-1', 0)).toBe('monthly-ai-credit-reserve:run-1')
    expect(attemptKey('monthly-ai-credit-reserve', 'run-1', 1)).toBe('monthly-ai-credit-reserve:run-1:1')
  })
})
