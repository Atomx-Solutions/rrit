import { createError } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import {
  allocatePlanCredits,
  consumeReservedCredits,
  creditPricing,
  creditsForCost,
  creditsForProviderCost,
  grantAdditionalCredits,
  reserveCredits,
} from '../../server/utils/credits'
import {
  creditTopUpPriceCents,
  isCreditTopUpQuantity,
} from '../../server/utils/credit-top-ups'

const organizationId = '00000000-0000-4000-8000-000000000001'

/** An in-memory single credit balance behind the SQL the credit utilities send. */
function balanceClient(remaining: number, reserved: number) {
  const state = { remaining, reserved }
  const row = () => ({ remaining_credits: state.remaining, reserved_credits: state.reserved, period_start: null, period_end: null })
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM credit_pricing'))
      return { rows: [{ credit_price_cents: 2, provider_cost_per_credit_micro_eur: 7000 }] }
    if (sql.includes('FOR UPDATE')) return { rows: [row()] }
    if (sql.includes('INSERT INTO credit_ledger')) return { rows: [{ id: `ledger-${query.mock.calls.length}` }] }
    if (sql.startsWith('UPDATE credit_balances')) {
      state.remaining += Number(values[1])
      state.reserved += Number(values[2])
      return { rows: [row()] }
    }
    return { rows: [] }
  })
  return { query, state }
}

const settle = (client: ReturnType<typeof balanceClient>, credits: number, reservedCredits: number, usageKind: 'research' | 'generation' = 'research') =>
  consumeReservedCredits(client as never, {
    organizationId,
    credits,
    reservedCredits,
    usageKind,
    referenceType: 'monthly_ai_run',
    referenceId: `run-${usageKind}`,
    idempotencyKey: `charge:${usageKind}`,
  })

describe('settling provider usage', () => {
  it('spends the reservation when usage fits inside it', async () => {
    const balance = await settle(balanceClient(60000, 31000), 20000, 31000)
    expect(balance).toMatchObject({ remaining: 40000, reserved: 11000 })
  })

  it('takes a web-search overrun from the free balance instead of failing', async () => {
    const balance = await settle(balanceClient(60000, 31000), 45000, 31000)
    expect(balance).toMatchObject({ remaining: 15000, reserved: 0 })
  })

  it('caps an empty balance at zero because the provider was already paid', async () => {
    const client = balanceClient(10000, 10000)
    const balance = await settle(client, 45000, 10000)
    expect(balance).toMatchObject({ remaining: 0, reserved: 0 })
    const ledger = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO credit_ledger'))
    expect(ledger?.[1]).toContain(-10000)
  })
})

describe('single credit balance', () => {
  it('charges research and then generation from the same 300-credit balance', async () => {
    const client = balanceClient(300, 0)
    await settle(client, 120, 0, 'research')
    const balance = await settle(client, 100, 0, 'generation')
    expect(balance).toMatchObject({ remaining: 80, reserved: 0, spendable: 80 })
  })

  it('reserves generation credits from the balance research also uses', async () => {
    vi.stubGlobal('createError', createError)
    const client = balanceClient(300, 0)
    await settle(client, 250, 0, 'research')
    await expect(
      reserveCredits(client as never, { organizationId, credits: 100, usageKind: 'generation', referenceType: 'ai_generation', referenceId: 'g', idempotencyKey: 'g' }),
    ).rejects.toMatchObject({ statusCode: 402, data: { code: 'CREDITS_EXHAUSTED' } })
  })

  it('adds a top-up to the single balance without splitting it', async () => {
    const client = balanceClient(0, 0)
    const balance = await grantAdditionalCredits(client as never, {
      organizationId,
      subscriptionId: 'subscription',
      credits: 500,
      referenceType: 'credit_purchase_test',
      referenceId: 'purchase',
      idempotencyKey: 'credit-purchase:purchase',
    })
    expect(balance).toMatchObject({ remaining: 500, spendable: 500 })
    const ledgerWrites = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO credit_ledger'))
    expect(ledgerWrites).toHaveLength(1)
    expect(String(ledgerWrites[0]?.[0])).not.toContain('wallet')
  })
})

describe('credit top-up pricing', () => {
  it('prices 500 credits at EUR 10.00', () => {
    expect(creditTopUpPriceCents(500, 2)).toBe(1000)
  })

  it.each([499, 1_000_001, 500.5])('rejects an invalid credit quantity: %s', (credits) => {
    expect(isCreditTopUpQuantity(credits)).toBe(false)
    expect(() => creditTopUpPriceCents(credits, 2)).toThrow('credits must be an integer')
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

describe('credit value', () => {
  it('charges one credit per EUR 0.007 of provider cost, rounded up', () => {
    expect(creditsForProviderCost(7000, 7000)).toBe(1)
    expect(creditsForProviderCost(7001, 7000)).toBe(2)
    // A EUR 0.14 post generation costs 20 credits, sold for EUR 0.40.
    expect(creditsForProviderCost(140_000, 7000)).toBe(20)
  })

  it('charges at least one credit for any paid call', () => {
    expect(creditsForProviderCost(0, 7000)).toBe(1)
    expect(creditsForProviderCost(1, 7000)).toBe(1)
  })

  it('reads the buy and sell price of a credit from credit_pricing', async () => {
    const client = balanceClient(0, 0)
    await expect(creditPricing(client as never)).resolves.toEqual({ creditPriceCents: 2, providerCostPerCreditMicroEur: 7000 })
    await expect(creditsForCost(client as never, 21_000)).resolves.toBe(3)
  })
})
