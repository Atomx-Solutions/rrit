import type { PoolClient } from 'pg'

/** Which AI activity spent the credits; all activities share one balance. */
export type CreditUsageKind = 'research' | 'generation'
export type CreditLedgerEvent = 'grant' | 'reserve' | 'release' | 'consume' | 'refund' | 'expire' | 'adjustment'

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
export type CreditPricing = { creditPriceCents: number; providerCostPerCreditMicroEur: number }

const balanceColumns = 'remaining_credits,reserved_credits,period_start,period_end'

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
 * One credit is a fixed slice of provider cost (EUR 0.007) sold at a fixed
 * price (EUR 0.02), so every AI action is charged by what it actually cost,
 * whatever the model or input/output token mix. A paid call costs at least
 * one credit.
 */
export function creditsForProviderCost(costMicroEur: number, providerCostPerCreditMicroEur: number) {
  nonNegativeInteger(costMicroEur, 'costMicroEur')
  positiveInteger(providerCostPerCreditMicroEur, 'providerCostPerCreditMicroEur')
  return Math.max(1, Math.ceil(costMicroEur / providerCostPerCreditMicroEur))
}
export async function creditPricing(client: Pick<PoolClient, 'query'>): Promise<CreditPricing> {
  const result = await client.query<{ credit_price_cents: number; provider_cost_per_credit_micro_eur: number }>(
    'SELECT credit_price_cents,provider_cost_per_credit_micro_eur FROM credit_pricing WHERE singleton=true',
  )
  const creditPriceCents = Number(result.rows[0]?.credit_price_cents)
  const providerCostPerCreditMicroEur = Number(result.rows[0]?.provider_cost_per_credit_micro_eur)
  if (!creditPriceCents || !providerCostPerCreditMicroEur) throw new Error('Credit pricing is not configured.')
  return { creditPriceCents, providerCostPerCreditMicroEur }
}
export async function creditsForCost(client: Pick<PoolClient, 'query'>, costMicroEur: number) {
  return creditsForProviderCost(costMicroEur, (await creditPricing(client)).providerCostPerCreditMicroEur)
}
/**
 * What the low-credit reminder needs: the configured threshold and whether the
 * organization has a package that can buy top-ups (the same subscriptions the
 * top-up endpoint accepts), or must choose a package first.
 */
export async function lowCreditStatus(client: Pick<PoolClient, 'query'>, organizationId: string) {
  const result = await client.query<{ low_credit_threshold: number; has_active_package: boolean }>(
    `SELECT p.low_credit_threshold,
            EXISTS (
              SELECT 1 FROM subscriptions s
               WHERE s.organization_id=$1 AND s.status IN ('trialing','active','past_due')
                 AND s.current_period_end > now()
            ) AS has_active_package
       FROM credit_pricing p WHERE p.singleton=true`,
    [organizationId],
  )
  const row = result.rows[0]
  return { threshold: Number(row?.low_credit_threshold ?? 100), hasActivePackage: Boolean(row?.has_active_package) }
}
export function allocatePlanCredits(monthlyCredits: number, postCount: number): CreditAllocation[] {
  nonNegativeInteger(monthlyCredits, 'monthlyCredits')
  positiveInteger(postCount, 'postCount')
  if (monthlyCredits < postCount) throw new Error('A plan must provide at least one credit for every advertised post.')
  const base = Math.floor(monthlyCredits / postCount)
  const remainder = monthlyCredits % postCount
  return Array.from({ length: postCount }, (_, index) => ({ slot: index + 1, credits: base + (index < remainder ? 1 : 0) }))
}

async function lockBalance(client: PoolClient, organizationId: string) {
  await client.query('INSERT INTO credit_balances(organization_id) VALUES($1) ON CONFLICT (organization_id) DO NOTHING', [organizationId])
  const result = await client.query<CreditBalanceRow>(
    `SELECT ${balanceColumns} FROM credit_balances WHERE organization_id=$1 FOR UPDATE`,
    [organizationId],
  )
  if (!result.rows[0]) throw new Error('Credit balance could not be locked.')
  return result.rows[0]
}
export async function creditBalanceSnapshot(client: PoolClient, organizationId: string) {
  const result = await client.query<CreditBalanceRow>(
    `SELECT ${balanceColumns} FROM credit_balances WHERE organization_id=$1`,
    [organizationId],
  )
  return toBalance(result.rows[0] || { remaining_credits: 0, reserved_credits: 0, period_start: null, period_end: null })
}
async function writeLedger(client: PoolClient, input: { organizationId: string; subscriptionId?: string | null; eventType: CreditLedgerEvent; usageKind?: CreditUsageKind; creditDelta: number; referenceType?: string; referenceId?: string; idempotencyKey?: string; metadata?: Record<string, unknown> }) {
  return client.query<{ id: string }>(
    `INSERT INTO credit_ledger(organization_id,subscription_id,event_type,usage_kind,credit_delta,reference_type,reference_id,idempotency_key,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
    [input.organizationId, input.subscriptionId || null, input.eventType, input.usageKind || null, input.creditDelta, input.referenceType || null, input.referenceId || null, input.idempotencyKey || null, JSON.stringify(input.metadata || {})],
  )
}
async function updateBalance(client: PoolClient, organizationId: string, remainingDelta: number, reservedDelta: number) {
  const result = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET remaining_credits=remaining_credits+$2,reserved_credits=reserved_credits+$3,updated_at=now()
     WHERE organization_id=$1 RETURNING ${balanceColumns}`,
    [organizationId, remainingDelta, reservedDelta],
  )
  return toBalance(result.rows[0]!)
}
function exhausted() {
  return createError({ statusCode: 402, data: { code: 'CREDITS_EXHAUSTED' }, message: 'Kreditet kane perfunduar.' })
}

export async function grantMonthlyCredits(client: PoolClient, input: { organizationId: string; subscriptionId: string; monthlyCredits: number; periodStart: Date; periodEnd: Date }) {
  positiveInteger(input.monthlyCredits, 'monthlyCredits')
  if (input.periodEnd <= input.periodStart) throw new Error('Credit period end must be after its start.')
  const balance = await lockBalance(client, input.organizationId)
  const periodKey = input.periodStart.toISOString()
  const grant = await writeLedger(client, { organizationId: input.organizationId, subscriptionId: input.subscriptionId, eventType: 'grant', creditDelta: input.monthlyCredits, referenceType: 'subscription_period', referenceId: periodKey, idempotencyKey: `credit-grant:${input.subscriptionId}:${periodKey}` })
  if (!grant.rows.length) return toBalance(balance)
  const prior = Number(balance.remaining_credits)
  if (prior) await writeLedger(client, { organizationId: input.organizationId, subscriptionId: input.subscriptionId, eventType: 'expire', creditDelta: -prior, referenceType: 'subscription_period', referenceId: balance.period_start ? new Date(balance.period_start).toISOString() : undefined, idempotencyKey: `credit-expire:${input.organizationId}:${periodKey}` })
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET remaining_credits=$2,reserved_credits=0,period_start=$3,period_end=$4,updated_at=now()
      WHERE organization_id=$1 RETURNING ${balanceColumns}`,
    [input.organizationId, input.monthlyCredits, input.periodStart, input.periodEnd],
  )
  return toBalance(updated.rows[0]!)
}
export async function grantAdditionalCredits(client: PoolClient, input: { organizationId: string; subscriptionId: string; credits: number; referenceType: string; referenceId: string; idempotencyKey: string; metadata?: Record<string, unknown> }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const grant = await writeLedger(client, { ...input, eventType: 'grant', creditDelta: input.credits })
  if (!grant.rows.length) return toBalance(balance)
  return updateBalance(client, input.organizationId, input.credits, 0)
}
export async function expireRemainingCredits(client: PoolClient, input: { organizationId: string; subscriptionId: string; idempotencyKey: string }) {
  const balance = await lockBalance(client, input.organizationId)
  const amount = Number(balance.remaining_credits)
  if (amount) await writeLedger(client, { ...input, eventType: 'expire', creditDelta: -amount, referenceType: 'subscription', referenceId: input.subscriptionId })
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET remaining_credits=0,reserved_credits=0,updated_at=now()
      WHERE organization_id=$1 RETURNING ${balanceColumns}`, [input.organizationId],
  )
  return toBalance(updated.rows[0]!)
}
export async function reserveCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  if (toBalance(balance).spendable < input.credits) throw exhausted()
  const ledger = await writeLedger(client, { ...input, eventType: 'reserve', creditDelta: 0 })
  if (!ledger.rows.length) return toBalance(balance)
  return updateBalance(client, input.organizationId, 0, input.credits)
}
export async function releaseReservedCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  if (Number(balance.reserved_credits) < input.credits) throw new Error('Cannot release more credits than reserved.')
  const ledger = await writeLedger(client, { ...input, eventType: 'release', creditDelta: 0 })
  if (!ledger.rows.length) return toBalance(balance)
  return updateBalance(client, input.organizationId, 0, -input.credits)
}
/**
 * Settles usage the provider has already charged, so it never fails: this
 * call's reservation is spent first, any overrun is taken from the free
 * balance, and the balance is capped at zero instead of rejecting the result.
 */
export async function consumeReservedCredits(client: PoolClient, input: { organizationId: string; credits: number; reservedCredits?: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const remaining = Number(balance.remaining_credits)
  const reserved = Number(balance.reserved_credits)
  const reservationUsed = Math.min(input.credits, input.reservedCredits ?? input.credits, reserved)
  const charged = Math.min(input.credits, remaining)
  const ledger = await writeLedger(client, {
    ...input,
    // A zero charge (empty balance) still needs an idempotent ledger entry.
    eventType: charged > 0 ? 'consume' : 'release',
    creditDelta: charged > 0 ? -charged : 0,
    metadata: { requestedCredits: input.credits, chargedCredits: charged },
  })
  if (!ledger.rows.length) return toBalance(balance)
  return updateBalance(client, input.organizationId, -charged, -reservationUsed)
}
export async function consumeCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  if (toBalance(balance).spendable < input.credits) throw exhausted()
  const ledger = await writeLedger(client, { ...input, eventType: 'consume', creditDelta: -input.credits })
  if (!ledger.rows.length) return toBalance(balance)
  return updateBalance(client, input.organizationId, -input.credits, 0)
}
