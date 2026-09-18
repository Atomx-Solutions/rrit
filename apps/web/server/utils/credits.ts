import type { PoolClient } from 'pg'

export type CreditUsageKind = 'research' | 'generation'
export type CreditWallet = CreditUsageKind
export type CreditLedgerEvent = 'grant' | 'reserve' | 'release' | 'consume' | 'refund' | 'expire' | 'adjustment'

type CreditBalanceRow = {
  research_remaining_credits: number
  research_reserved_credits: number
  generation_remaining_credits: number
  generation_reserved_credits: number
  period_start: Date | string | null
  period_end: Date | string | null
}

export type WalletBalance = { remaining: number; reserved: number; spendable: number }
export type CreditBalance = {
  research: WalletBalance
  generation: WalletBalance
  periodStart: string | null
  periodEnd: string | null
}
export type CreditAllocation = { slot: number; credits: number }

const walletColumns: Record<CreditWallet, { remaining: string; reserved: string }> = {
  research: { remaining: 'research_remaining_credits', reserved: 'research_reserved_credits' },
  generation: { remaining: 'generation_remaining_credits', reserved: 'generation_reserved_credits' },
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}
function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}
function walletBalance(remaining: number, reserved: number): WalletBalance {
  return { remaining: Number(remaining), reserved: Number(reserved), spendable: Number(remaining) - Number(reserved) }
}
function toBalance(row: CreditBalanceRow): CreditBalance {
  return {
    research: walletBalance(row.research_remaining_credits, row.research_reserved_credits),
    generation: walletBalance(row.generation_remaining_credits, row.generation_reserved_credits),
    periodStart: row.period_start ? new Date(row.period_start).toISOString() : null,
    periodEnd: row.period_end ? new Date(row.period_end).toISOString() : null,
  }
}
export function splitCredits(credits: number) {
  const research = Math.floor(credits / 2)
  return { research, generation: credits - research }
}

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
  const result = await client.query<{ provider_token_cost_micro_eur: number }>('SELECT provider_token_cost_micro_eur FROM credit_pricing WHERE singleton=true')
  const cost = Number(result.rows[0]?.provider_token_cost_micro_eur)
  if (!cost) throw new Error('Credit pricing is not configured.')
  return creditsForProviderCost(costMicroEur, cost)
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
    `SELECT research_remaining_credits,research_reserved_credits,generation_remaining_credits,generation_reserved_credits,period_start,period_end
       FROM credit_balances WHERE organization_id=$1 FOR UPDATE`,
    [organizationId],
  )
  if (!result.rows[0]) throw new Error('Credit balance could not be locked.')
  return result.rows[0]
}
export async function creditWalletSnapshot(client: PoolClient, organizationId: string) {
  const result = await client.query<CreditBalanceRow>(
    `SELECT research_remaining_credits,research_reserved_credits,generation_remaining_credits,generation_reserved_credits,period_start,period_end
       FROM credit_balances WHERE organization_id=$1`,
    [organizationId],
  )
  return result.rows[0] ? toBalance(result.rows[0]) : toBalance({ research_remaining_credits: 0, research_reserved_credits: 0, generation_remaining_credits: 0, generation_reserved_credits: 0, period_start: null, period_end: null })
}
async function writeLedger(client: PoolClient, input: { organizationId: string; subscriptionId?: string | null; eventType: CreditLedgerEvent; wallet: CreditWallet; creditDelta: number; referenceType?: string; referenceId?: string; idempotencyKey?: string; metadata?: Record<string, unknown> }) {
  return client.query<{ id: string }>(
    `INSERT INTO credit_ledger(organization_id,subscription_id,event_type,usage_kind,wallet,credit_delta,reference_type,reference_id,idempotency_key,metadata)
     VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
    [input.organizationId, input.subscriptionId || null, input.eventType, input.wallet, input.creditDelta, input.referenceType || null, input.referenceId || null, input.idempotencyKey || null, JSON.stringify(input.metadata || {})],
  )
}
async function updateWallet(client: PoolClient, organizationId: string, wallet: CreditWallet, remainingDelta: number, reservedDelta: number, period?: { start: Date; end: Date }) {
  const columns = walletColumns[wallet]
  const result = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET ${columns.remaining}=${columns.remaining}+$2,${columns.reserved}=${columns.reserved}+$3,
       period_start=COALESCE($4,period_start),period_end=COALESCE($5,period_end),updated_at=now()
     WHERE organization_id=$1
     RETURNING research_remaining_credits,research_reserved_credits,generation_remaining_credits,generation_reserved_credits,period_start,period_end`,
    [organizationId, remainingDelta, reservedDelta, period?.start || null, period?.end || null],
  )
  return toBalance(result.rows[0]!)
}
function exhausted(wallet: CreditWallet) {
  return createError({ statusCode: 402, data: { code: 'CREDIT_WALLET_EXHAUSTED', wallet }, message: 'Kreditet per kete veprim kane perfunduar.' })
}

export async function grantMonthlyCredits(client: PoolClient, input: { organizationId: string; subscriptionId: string; monthlyCredits: number; periodStart: Date; periodEnd: Date }) {
  positiveInteger(input.monthlyCredits, 'monthlyCredits')
  if (input.periodEnd <= input.periodStart) throw new Error('Credit period end must be after its start.')
  const balance = await lockBalance(client, input.organizationId)
  const periodKey = input.periodStart.toISOString()
  const grant = await writeLedger(client, { organizationId: input.organizationId, subscriptionId: input.subscriptionId, eventType: 'grant', wallet: 'research', creditDelta: splitCredits(input.monthlyCredits).research, referenceType: 'subscription_period', referenceId: periodKey, idempotencyKey: `credit-grant:${input.subscriptionId}:${periodKey}:research` })
  if (!grant.rows.length) return toBalance(balance)
  const allocation = splitCredits(input.monthlyCredits)
  await writeLedger(client, { organizationId: input.organizationId, subscriptionId: input.subscriptionId, eventType: 'grant', wallet: 'generation', creditDelta: allocation.generation, referenceType: 'subscription_period', referenceId: periodKey, idempotencyKey: `credit-grant:${input.subscriptionId}:${periodKey}:generation` })
  for (const wallet of ['research', 'generation'] as const) {
    const prior = walletBalance(balance[`${wallet}_remaining_credits`], balance[`${wallet}_reserved_credits`])
    if (prior.remaining) await writeLedger(client, { organizationId: input.organizationId, subscriptionId: input.subscriptionId, eventType: 'expire', wallet, creditDelta: -prior.remaining, referenceType: 'subscription_period', referenceId: balance.period_start ? new Date(balance.period_start).toISOString() : undefined, idempotencyKey: `credit-expire:${input.organizationId}:${periodKey}:${wallet}` })
  }
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET research_remaining_credits=$2,research_reserved_credits=0,generation_remaining_credits=$3,generation_reserved_credits=0,remaining_credits=0,reserved_credits=0,period_start=$4,period_end=$5,updated_at=now()
      WHERE organization_id=$1 RETURNING research_remaining_credits,research_reserved_credits,generation_remaining_credits,generation_reserved_credits,period_start,period_end`,
    [input.organizationId, allocation.research, allocation.generation, input.periodStart, input.periodEnd],
  )
  return toBalance(updated.rows[0]!)
}
export async function grantAdditionalCredits(client: PoolClient, input: { organizationId: string; subscriptionId: string; credits: number; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const allocation = splitCredits(input.credits)
  const grant = await writeLedger(client, { ...input, eventType: 'grant', wallet: 'research', creditDelta: allocation.research, idempotencyKey: `${input.idempotencyKey}:research` })
  if (!grant.rows.length) return toBalance(balance)
  await writeLedger(client, { ...input, eventType: 'grant', wallet: 'generation', creditDelta: allocation.generation, idempotencyKey: `${input.idempotencyKey}:generation` })
  await updateWallet(client, input.organizationId, 'research', allocation.research, 0)
  return updateWallet(client, input.organizationId, 'generation', allocation.generation, 0)
}
export async function expireRemainingCredits(client: PoolClient, input: { organizationId: string; subscriptionId: string; idempotencyKey: string }) {
  const balance = await lockBalance(client, input.organizationId)
  for (const wallet of ['research', 'generation'] as const) {
    const amount = balance[`${wallet}_remaining_credits`]
    if (amount) await writeLedger(client, { ...input, eventType: 'expire', wallet, creditDelta: -Number(amount), referenceType: 'subscription', referenceId: input.subscriptionId, idempotencyKey: `${input.idempotencyKey}:${wallet}` })
  }
  const updated = await client.query<CreditBalanceRow>(
    `UPDATE credit_balances SET research_remaining_credits=0,research_reserved_credits=0,generation_remaining_credits=0,generation_reserved_credits=0,remaining_credits=0,reserved_credits=0,updated_at=now()
      WHERE organization_id=$1 RETURNING research_remaining_credits,research_reserved_credits,generation_remaining_credits,generation_reserved_credits,period_start,period_end`, [input.organizationId],
  )
  return toBalance(updated.rows[0]!)
}
export async function reserveCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const columns = walletColumns[input.usageKind]
  if (Number(balance[columns.remaining as keyof CreditBalanceRow]) - Number(balance[columns.reserved as keyof CreditBalanceRow]) < input.credits) throw exhausted(input.usageKind)
  const ledger = await writeLedger(client, { ...input, eventType: 'reserve', wallet: input.usageKind, creditDelta: 0 })
  if (!ledger.rows.length) return toBalance(balance)
  return updateWallet(client, input.organizationId, input.usageKind, 0, input.credits)
}
export async function releaseReservedCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const reserved = Number(balance[walletColumns[input.usageKind].reserved as keyof CreditBalanceRow])
  if (reserved < input.credits) throw new Error('Cannot release more credits than reserved.')
  const ledger = await writeLedger(client, { ...input, eventType: 'release', wallet: input.usageKind, creditDelta: 0 })
  if (!ledger.rows.length) return toBalance(balance)
  return updateWallet(client, input.organizationId, input.usageKind, 0, -input.credits)
}
export async function consumeReservedCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const columns = walletColumns[input.usageKind]
  if (Number(balance[columns.reserved as keyof CreditBalanceRow]) < input.credits || Number(balance[columns.remaining as keyof CreditBalanceRow]) < input.credits) throw exhausted(input.usageKind)
  const ledger = await writeLedger(client, { ...input, eventType: 'consume', wallet: input.usageKind, creditDelta: -input.credits })
  if (!ledger.rows.length) return toBalance(balance)
  return updateWallet(client, input.organizationId, input.usageKind, -input.credits, -input.credits)
}
export async function consumeCredits(client: PoolClient, input: { organizationId: string; credits: number; usageKind: CreditUsageKind; referenceType: string; referenceId: string; idempotencyKey: string }) {
  positiveInteger(input.credits, 'credits')
  const balance = await lockBalance(client, input.organizationId)
  const columns = walletColumns[input.usageKind]
  if (Number(balance[columns.remaining as keyof CreditBalanceRow]) - Number(balance[columns.reserved as keyof CreditBalanceRow]) < input.credits) throw exhausted(input.usageKind)
  const ledger = await writeLedger(client, { ...input, eventType: 'consume', wallet: input.usageKind, creditDelta: -input.credits })
  if (!ledger.rows.length) return toBalance(balance)
  return updateWallet(client, input.organizationId, input.usageKind, -input.credits, 0)
}
