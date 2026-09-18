import type { PoolClient } from 'pg'

export type CreditUsageKind = 'research' | 'generation'
export type CreditLedgerEvent =
  | 'grant'
  | 'reserve'
  | 'release'
  | 'consume'
  | 'refund'
  | 'expire'
  | 'adjustment'

type CreditBalanceRow = {
  remaining_credits: number
  reserved_credits: number
  period_start: Date | string | null
  period_end: Date | string | null
}

export type CreditBalance = {
  remaining: number
  reserved: number
  spendable: number
  periodStart: string | null
  periodEnd: string | null
}

export type CreditAllocation = { slot: number; credits: number }

/** One sold credit equals one billable AI token (input or output). */
export function creditsForAiUsage(inputTokens: number, outputTokens: number) {
  return nonNegativeInteger(inputTokens, 'inputTokens') + nonNegativeInteger(outputTokens, 'outputTokens')
}

export function creditsForProviderCost(costMicroEur: number, providerTokenCostMicroEur: number) {
  positiveInteger(costMicroEur, 'costMicroEur')
  positiveInteger(providerTokenCostMicroEur, 'providerTokenCostMicroEur')
  return Math.ceil(costMicroEur / providerTokenCostMicroEur)
}

export async function creditsForImageProviderCost(client: PoolClient, costMicroEur: number) {
  const pricing = await client.query<{ provider_token_cost_micro_eur: number }>(
    'SELECT provider_token_cost_micro_eur FROM credit_pricing WHERE singleton=true',
  )
  const providerCost = Number(pricing.rows[0]?.provider_token_cost_micro_eur)
  if (!providerCost) throw new Error('Credit pricing is not configured.')
  return creditsForProviderCost(costMicroEur, providerCost)
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function toBalance(row: CreditBalanceRow): CreditBalance {
  const remaining = Number(row.remaining_credits)
  const reserved = Number(row.reserved_credits)
  return {
    remaining,
    reserved,
    spendable: remaining - reserved,
    periodStart: row.period_start ? new Date(row.period_start).toISOString() : null,
    periodEnd: row.period_end ? new Date(row.period_end).toISOString() : null,
  }
}

/**
 * Distributes a plan's common monthly credit budget across every post slot.
 * The difference between any two slots is at most one credit, so the package
 * always has exactly enough budget for its advertised post allowance.
 */
export function allocatePlanCredits(monthlyCredits: number, postCount: number): CreditAllocation[] {
  nonNegativeInteger(monthlyCredits, 'monthlyCredits')
  positiveInteger(postCount, 'postCount')
  if (monthlyCredits < postCount)
    throw new Error('A plan must provide at least one credit for every advertised post.')
  const base = Math.floor(monthlyCredits / postCount)
  const remainder = monthlyCredits % postCount
  return Array.from({ length: postCount }, (_, index) => ({
    slot: index + 1,
    credits: base + (index < remainder ? 1 : 0),
  }))
}

async function lockBalance(client: PoolClient, organizationId: string) {
  await client.query(
    'INSERT INTO credit_balances(organization_id) VALUES($1) ON CONFLICT (organization_id) DO NOTHING',
    [organizationId],
  )
  const result = await client.query<CreditBalanceRow>(
    'SELECT remaining_credits,reserved_credits,period_start,period_end FROM credit_balances WHERE organization_id=$1 FOR UPDATE',
    [organizationId],
  )
  const balance = result.rows[0]
  if (!balance) throw new Error('Credit balance could not be locked.')
  return balance
}

async function writeLedger(
  client: PoolClient,
  input: {
    organizationId: string
    subscriptionId?: string | null
    eventType: CreditLedgerEvent
    usageKind?: CreditUsageKind
    creditDelta: number
    referenceType?: string
    referenceId?: string
    idempotencyKey?: string
    metadata?: Record<string, unknown>
  },
) {
  return client.query<{ id: string }>(
    `INSERT INTO credit_ledger
      (organization_id,subscription_id,event_type,usage_kind,credit_delta,reference_type,reference_id,idempotency_key,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      input.organizationId,
      input.subscriptionId || null,
      input.eventType,
      input.usageKind || null,
      input.creditDelta,
      input.referenceType || null,
      input.referenceId || null,
      input.idempotencyKey || null,
      JSON.stringify(input.metadata || {}),
    ],
  )
}

export async function grantMonthlyCredits(
  client: PoolClient,
  input: {
    organizationId: string
    subscriptionId: string
    monthlyCredits: number
    periodStart: Date
    periodEnd: Date
  },
) {
  positiveInteger(input.monthlyCredits, 'monthlyCredits')
  if (input.periodEnd <= input.periodStart) throw new Error('Credit period end must be after its start.')
  const balance = await lockBalance(client, input.organizationId)
  const periodKey = input.periodStart.toISOString()
  const grant = await writeLedger(client, {
    organizationId: input.organizationId,
    subscriptionId: input.subscriptionId,
    eventType: 'grant',
    creditDelta: input.monthlyCredits,
    referenceType: 'subscription_period',
    referenceId: periodKey,
    idempotencyKey: `credit-grant:${input.subscriptionId}:${periodKey}`,
  })
  if (!grant.rows.length) return toBalance(balance)

  // A new monthly grant expires every unused and reserved credit from the
  // preceding paid period before depositing the new plan allowance.
  const remaining = Number(balance.remaining_credits)
  if (remaining > 0)
    await writeLedger(client, {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      eventType: 'expire',
      creditDelta: -remaining,
      referenceType: 'subscription_period',
      referenceId: balance.period_start ? new Date(balance.period_start).toISOString() : undefined,
      idempotencyKey: `credit-expire:${input.organizationId}:${periodKey}`,
    })
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances
        SET remaining_credits=$2,reserved_credits=0,period_start=$3,period_end=$4,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId, input.monthlyCredits, input.periodStart, input.periodEnd],
  )
  return toBalance(updated.rows[0]!)
}

/** Adds credits to the current period without expiring the existing balance,
 * for example the allowance difference of a mid-period package upgrade. */
export async function grantAdditionalCredits(
  client: PoolClient,
  input: {
    organizationId: string
    subscriptionId: string
    credits: number
    referenceType: string
    referenceId: string
    idempotencyKey: string
  },
) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const grant = await writeLedger(client, {
    ...input,
    eventType: 'grant',
    creditDelta: input.credits,
  })
  if (!grant.rows.length) return toBalance(balance)
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET remaining_credits=remaining_credits+$2,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId, input.credits],
  )
  return toBalance(updated.rows[0]!)
}

/** Expires every remaining credit, for example when a subscription ends. */
export async function expireRemainingCredits(
  client: PoolClient,
  input: { organizationId: string; subscriptionId: string; idempotencyKey: string },
) {
  const balance = await lockBalance(client, input.organizationId)
  const remaining = Number(balance.remaining_credits)
  if (remaining > 0) {
    const expired = await writeLedger(client, {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      eventType: 'expire',
      creditDelta: -remaining,
      referenceType: 'subscription',
      referenceId: input.subscriptionId,
      idempotencyKey: input.idempotencyKey,
    })
    if (!expired.rows.length) return toBalance(balance)
  }
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET remaining_credits=0,reserved_credits=0,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId],
  )
  return toBalance(updated.rows[0]!)
}

export async function reserveCredits(
  client: PoolClient,
  input: {
    organizationId: string
    credits: number
    usageKind: CreditUsageKind
    referenceType: string
    referenceId: string
    idempotencyKey: string
  },
) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const ledger = await writeLedger(client, {
    ...input,
    eventType: 'reserve',
    creditDelta: 0,
  })
  if (!ledger.rows.length) return toBalance(balance)
  if (Number(balance.remaining_credits) - Number(balance.reserved_credits) < input.credits)
    throw createError({ statusCode: 402, data: { code: 'CREDITS_EXHAUSTED' }, message: 'Nuk ke kredi të mjaftueshme.' })
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET reserved_credits=reserved_credits+$2,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId, input.credits],
  )
  return toBalance(updated.rows[0]!)
}

export async function releaseReservedCredits(
  client: PoolClient,
  input: {
    organizationId: string
    credits: number
    usageKind: CreditUsageKind
    referenceType: string
    referenceId: string
    idempotencyKey: string
  },
) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const ledger = await writeLedger(client, { ...input, eventType: 'release', creditDelta: 0 })
  if (!ledger.rows.length) return toBalance(balance)
  if (Number(balance.reserved_credits) < input.credits) throw new Error('Cannot release more credits than reserved.')
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET reserved_credits=reserved_credits-$2,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId, input.credits],
  )
  return toBalance(updated.rows[0]!)
}

export async function consumeReservedCredits(
  client: PoolClient,
  input: {
    organizationId: string
    credits: number
    usageKind: CreditUsageKind
    referenceType: string
    referenceId: string
    idempotencyKey: string
  },
) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const ledger = await writeLedger(client, { ...input, eventType: 'consume', creditDelta: -input.credits })
  if (!ledger.rows.length) return toBalance(balance)
  if (Number(balance.reserved_credits) < input.credits || Number(balance.remaining_credits) < input.credits)
    throw new Error('Cannot consume more credits than reserved.')
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances
        SET remaining_credits=remaining_credits-$2,reserved_credits=reserved_credits-$2,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId, input.credits],
  )
  return toBalance(updated.rows[0]!)
}

/** Charge completed AI usage that was not pre-reserved (for example, an
 * interactive caption request whose exact provider token count is returned
 * only with the response). Call this in the same transaction as settlement. */
export async function consumeCredits(
  client: PoolClient,
  input: {
    organizationId: string
    credits: number
    usageKind: CreditUsageKind
    referenceType: string
    referenceId: string
    idempotencyKey: string
  },
) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  if (Number(balance.remaining_credits) - Number(balance.reserved_credits) < input.credits)
    throw createError({ statusCode: 402, data: { code: 'CREDITS_EXHAUSTED' }, message: 'Nuk ke kredi të mjaftueshme.' })
  const ledger = await writeLedger(client, { ...input, eventType: 'consume', creditDelta: -input.credits })
  if (!ledger.rows.length) return toBalance(balance)
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET remaining_credits=remaining_credits-$2,updated_at=now()
      WHERE organization_id=$1
      RETURNING remaining_credits,reserved_credits,period_start,period_end`,
    [input.organizationId, input.credits],
  )
  return toBalance(updated.rows[0]!)
}
