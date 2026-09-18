import { describe, expect, it, vi } from 'vitest'
import {
  allocatePlanCredits,
  consumeReservedCredits,
  creditsForAiUsage,
  creditsForProviderCost,
  splitCredits,
} from '../../server/utils/credits'

function walletClient(remaining: number, reserved: number) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FOR UPDATE'))
      return {
        rows: [
          {
            research_remaining_credits: remaining,
            research_reserved_credits: reserved,
            generation_remaining_credits: 0,
            generation_reserved_credits: 0,
            period_start: null,
            period_end: null,
          },
        ],
      }
    if (sql.includes('INSERT INTO credit_ledger')) return { rows: [{ id: 'ledger-entry' }], values }
    if (sql.startsWith('UPDATE credit_balances'))
      return {
        rows: [
          {
            research_remaining_credits: remaining + Number(values[1]),
            research_reserved_credits: reserved + Number(values[2]),
            generation_remaining_credits: 0,
            generation_reserved_credits: 0,
            period_start: null,
            period_end: null,
          },
        ],
      }
    return { rows: [] }
  })
  return { query }
}

const settle = (client: ReturnType<typeof walletClient>, credits: number, reservedCredits: number) =>
  consumeReservedCredits(client as never, {
    organizationId: '00000000-0000-4000-8000-000000000001',
    credits,
    reservedCredits,
    usageKind: 'research',
    referenceType: 'monthly_ai_run',
    referenceId: 'run',
    idempotencyKey: 'charge:run',
  })

describe('settling provider usage', () => {
  it('spends the reservation when usage fits inside it', async () => {
    const balance = await settle(walletClient(60000, 31000), 20000, 31000)
    expect(balance.research).toMatchObject({ remaining: 40000, reserved: 11000 })
  })

  it('takes a web-search overrun from the free balance instead of failing', async () => {
    const balance = await settle(walletClient(60000, 31000), 45000, 31000)
    expect(balance.research).toMatchObject({ remaining: 15000, reserved: 0 })
  })

  it('caps an empty wallet at zero because the provider was already paid', async () => {
    const client = walletClient(10000, 10000)
    const balance = await settle(client, 45000, 10000)
    expect(balance.research).toMatchObject({ remaining: 0, reserved: 0 })
    const ledger = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO credit_ledger'))
    expect(ledger?.[1]).toContain(-10000)
  })
})

describe('credit wallet allocation', () => {
  it.each([
    [1000, { research: 500, generation: 500 }],
    [2250, { research: 1125, generation: 1125 }],
    [4000, { research: 2000, generation: 2000 }],
  ])('splits %i monthly credits equally', (credits, expected) => {
    expect(splitCredits(credits)).toEqual(expected)
  })
})

describe('plan credit allocation', () => {
  it.each([
    [250, 3],
    [1000, 14],
    [2250, 30],
    [4000, 60],
  ])('covers every advertised post for %i credits and %i posts', (credits, posts) => {
    const allocation = allocatePlanCredits(credits, posts)
    expect(allocation).toHaveLength(posts)
    expect(allocation.reduce((sum, item) => sum + item.credits, 0)).toBe(credits)
    expect(Math.max(...allocation.map((item) => item.credits)) - Math.min(...allocation.map((item) => item.credits))).toBeLessThanOrEqual(1)
  })

  it('rejects an allowance that cannot fund every advertised post', () => {
    expect(() => allocatePlanCredits(10, 14)).toThrow('at least one credit')
  })
})

describe('AI token charging', () => {
  it('charges both input and output tokens from the common credit balance', () => {
    expect(creditsForAiUsage(120, 80)).toBe(200)
  })

  it('rounds an image provider cost up to the purchased token unit', () => {
    expect(creditsForProviderCost(7001, 7000)).toBe(2)
  })
})
