import { createHash } from 'node:crypto'
import { aiCreditCycleStartSql } from './ai-credits'
import { aiCostConfiguration, aiCostConfigured, calculateAiCost } from './ai-costs'
import {
  consumeReservedCredits,
  creditsForCost,
  releaseReservedCredits,
  reserveCredits,
} from './credits'
import { aiProviderConfiguration, aiProviderModel, providerCostMicroEur } from './ai-provider'

export type TextAiUsage = { inputTokens?: number; outputTokens?: number; costUsd?: number | null; responseId?: string; model?: string }

/**
 * Runs one short text request for a business and charges it to the business's
 * credits the way captions are charged: the request is reserved (daily quota,
 * cost budget, credits) before the model is called, settled at its real cost
 * after, and released in full when the model fails.
 */
export async function chargedTextAi<T>(
  userId: string,
  businessId: string,
  args: {
    requestId: string
    input: unknown
    kind: string
    reservedInputTokens: number
    reservedOutputTokens: number
    run: () => Promise<{ output: T; usage: TextAiUsage }>
  },
): Promise<T> {
  let model: string
  try {
    aiProviderConfiguration()
    model = aiProviderModel('OPENAI_MODEL')
  } catch {
    throw createError({ statusCode: 503, message: 'server.AI_ASSISTANT_NOT_ENABLED' })
  }
  if (!aiCostConfigured()) throw createError({ statusCode: 503, message: 'server.AI_ASSISTANT_NOT_ENABLED' })
  const digest = createHash('sha256').update(JSON.stringify([args.kind, args.input])).digest('hex')
  const reservedCost = calculateAiCost(args.reservedInputTokens, args.reservedOutputTokens)
  const reference = { usageKind: 'generation' as const, referenceType: 'ai_generation', referenceId: args.requestId }

  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId, organizationId: businessId })
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId])
    await requireEntitlement(businessId, 'ai', client)
    const previous = await client.query(
      'SELECT business_id,input_hash,status,output FROM ai_generations WHERE id=$1',
      [args.requestId],
    )
    if (previous.rows[0]) {
      const item = previous.rows[0]
      if (item.business_id !== businessId || item.input_hash !== digest)
        throw createError({ statusCode: 409, message: 'server.AI_REQUEST_CHANGED' })
      if (item.status !== 'completed')
        throw createError({ statusCode: 409, message: 'server.AI_REQUEST_IN_PROGRESS' })
      await client.query('COMMIT')
      return item.output as T
    }
    const limit = (await trialStatus(businessId, client)).limits.ai_requests_per_day
    const quota = await client.query(
      "INSERT INTO ai_daily_usage (business_id,usage_day,requests) VALUES ($1,(now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(business_id,usage_day) DO UPDATE SET requests=ai_daily_usage.requests+1 WHERE ai_daily_usage.requests<$2 RETURNING requests",
      [businessId, limit],
    )
    if (!quota.rows.length) throw createError({ statusCode: 429, message: 'server.AI_DAILY_LIMIT_REACHED' })
    await client.query(
      "INSERT INTO ai_generations (id,business_id,input_hash,status) VALUES ($1,$2,$3,'pending')",
      [args.requestId, businessId, digest],
    )
    const spent = await client.query(
      `SELECT COALESCE(sum(CASE WHEN status='committed' THEN actual_cost_micro_eur ELSE reserved_cost_micro_eur END),0)::bigint AS total
       FROM ai_cost_ledger WHERE business_id=$1 AND created_at>=${aiCreditCycleStartSql}
         AND status IN ('reserved','committed')`,
      [businessId],
    )
    const monthlySpent = await client.query(
      `SELECT COALESCE(sum(COALESCE(actual_cost_micro_eur,reserved_cost_micro_eur)),0)::text AS total
       FROM monthly_ai_runs WHERE business_id=$1 AND created_at>=${aiCreditCycleStartSql}
         AND status IN ('reserved','completed','uncertain')`,
      [businessId],
    )
    if (Number(spent.rows[0].total) + Number(monthlySpent.rows[0].total) + reservedCost > aiCostConfiguration().dailyBudgetMicroEur)
      throw createError({ statusCode: 429, message: 'server.AI_COST_LIMIT_REACHED' })
    await client.query(
      "INSERT INTO ai_cost_ledger(generation_id,business_id,model,status,estimated_input_tokens,reserved_output_tokens,reserved_cost_micro_eur) VALUES($1,$2,$3,'reserved',$4,$5,$6)",
      [args.requestId, businessId, model, args.reservedInputTokens, args.reservedOutputTokens, reservedCost],
    )
    await reserveCredits(client, {
      organizationId: businessId,
      credits: await creditsForCost(client, reservedCost),
      ...reference,
      idempotencyKey: `${args.kind}-credit-reserve:${args.requestId}`,
    })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  let result: { output: T; usage: TextAiUsage }
  try {
    result = await args.run()
  } catch (error) {
    await releaseCharge(userId, businessId, args.requestId, args.kind, reservedCost)
    if (error instanceof Error) console.warn(`A ${args.kind} request failed`, { error: error.message })
    throw createError({ statusCode: 502, message: 'server.AI_RESPONSE_INCOMPLETE' })
  }

  const inputTokens = Math.max(0, Math.trunc(result.usage.inputTokens ?? args.reservedInputTokens))
  const outputTokens = Math.max(0, Math.trunc(result.usage.outputTokens ?? args.reservedOutputTokens))
  const settlement = await database().connect()
  try {
    await settlement.query('BEGIN')
    await setTenantContext(settlement, { userId, organizationId: businessId })
    await settlement.query(
      "UPDATE ai_generations SET status='completed',output=$1,completed_at=now() WHERE id=$2 AND business_id=$3 AND status='pending'",
      [JSON.stringify(result.output), args.requestId, businessId],
    )
    const actualCost =
      providerCostMicroEur(result.usage.costUsd, Number(process.env.AI_USD_MICRO_EUR)) ??
      calculateAiCost(inputTokens, outputTokens)
    const actualCredits = await creditsForCost(settlement, actualCost)
    const reservedCredits = await creditsForCost(settlement, reservedCost)
    await consumeReservedCredits(settlement, {
      organizationId: businessId,
      credits: actualCredits,
      reservedCredits,
      ...reference,
      idempotencyKey: `${args.kind}-token-charge:${args.requestId}`,
    })
    if (reservedCredits > actualCredits)
      await releaseReservedCredits(settlement, {
        organizationId: businessId,
        credits: reservedCredits - actualCredits,
        ...reference,
        idempotencyKey: `${args.kind}-credit-release:${args.requestId}`,
      })
    await settlement.query(
      "UPDATE ai_cost_ledger SET status='committed',actual_input_tokens=$1,actual_output_tokens=$2,actual_cost_micro_eur=$3,settled_at=now(),provider_cost_usd=$6,provider_key_fingerprint=$7,provider_response_id=$8,provider_model=$9,provider_input_tokens=$1,provider_output_tokens=$2 WHERE generation_id=$4 AND business_id=$5 AND status='reserved'",
      [
        inputTokens,
        outputTokens,
        actualCost,
        args.requestId,
        businessId,
        result.usage.costUsd ?? null,
        aiProviderConfiguration().keyFingerprint,
        result.usage.responseId ?? null,
        result.usage.model ?? model,
      ],
    )
    await settlement.query('COMMIT')
  } catch (error) {
    await settlement.query('ROLLBACK')
    throw error
  } finally {
    settlement.release()
  }
  return result.output
}

async function releaseCharge(userId: string, businessId: string, requestId: string, kind: string, reservedCost: number) {
  const release = await database().connect()
  try {
    await release.query('BEGIN')
    await setTenantContext(release, { userId, organizationId: businessId })
    const released = await release.query(
      "UPDATE ai_cost_ledger SET status='released',settled_at=now() WHERE generation_id=$1 AND business_id=$2 AND status='reserved' RETURNING id",
      [requestId, businessId],
    )
    await release.query(
      "UPDATE ai_generations SET status='failed',completed_at=now() WHERE id=$1 AND business_id=$2 AND status='pending'",
      [requestId, businessId],
    )
    if (released.rowCount) {
      await releaseReservedCredits(release, {
        organizationId: businessId,
        credits: await creditsForCost(release, reservedCost),
        usageKind: 'generation',
        referenceType: 'ai_generation',
        referenceId: requestId,
        idempotencyKey: `${kind}-credit-release:${requestId}`,
      })
      await release.query(
        "UPDATE ai_daily_usage SET requests=GREATEST(requests-1,0) WHERE business_id=$1 AND usage_day=(now() AT TIME ZONE 'UTC')::date",
        [businessId],
      )
    }
    await release.query('COMMIT')
  } catch {
    await release.query('ROLLBACK')
    console.error('AI reservation release failed; reconciliation is required.')
  } finally {
    release.release()
  }
}
