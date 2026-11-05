import type { PoolClient } from 'pg'
import { PlannerFailure } from './monthly-planner-domain'
import { creditsForCost, releaseReservedCredits, type CreditUsageKind } from './credits'

// What a stage's run is marked once its call is known to have been cut off.
export const interruptedRunCode = 'PROVIDER_INTERRUPTED'

// How long a run's answer takes to be written after its call has ended. A run
// still reserved after its call's own timeout and this margin has no process
// left that could still finish it.
export const callSettleMarginMs = 60000

/**
 * The credit key of one attempt at a stage. A stage called again keeps its run
 * row, so every attempt after the first has keys of its own; otherwise a retry
 * would find the first attempt's reservation already written and reserve
 * nothing, then settle credits it never held. The first attempt keeps the keys
 * runs were always given, so runs stored before this keep theirs.
 */
export function attemptKey(prefix: string, runId: string, attempt: number) {
  return attempt > 0 ? `${prefix}:${runId}:${attempt}` : `${prefix}:${runId}`
}

type StoredRun = Record<string, unknown> & { id: unknown; status: unknown }

/**
 * A run left 'reserved' after its call could have ended was cut off with its
 * process (a host that stops the function in the middle of the call), and one
 * left 'uncertain' lost the provider's answer on the way back. Either used to
 * block its stage for good, leaving the business only "Start over", which
 * pays for research and strategy again. Such a run is marked as interrupted
 * and the credits its attempt held are returned, so the stage is called once
 * more and the business is charged only for the call whose answer it gets.
 * A reservation still young may belong to a call that is running now, so the
 * stage waits for it as for any temporary interruption instead.
 */
export async function settleInterruptedRun(
  client: Pick<PoolClient, 'query'>,
  run: StoredRun | undefined,
  options: {
    businessId: string
    callTimeoutMs: number
    reserveKeyPrefix: string
    releaseKeyPrefix: string
    usageKind: CreditUsageKind
    now?: number
  },
) {
  if (!run || (run.status !== 'reserved' && run.status !== 'uncertain')) return run
  const reservedAt = new Date(String(run.created_at)).getTime()
  const now = options.now ?? Date.now()
  const runId = String(run.id)
  const attempt = Number(run.retry_count || 0)
  const described = { runId, stageKey: String(run.stage_key || ''), status: run.status, attempt, ageSeconds: Math.round((now - reservedAt) / 1000) }
  if (run.status === 'reserved' && !(now - reservedAt > options.callTimeoutMs + callSettleMarginMs)) {
    console.info('A stage waits for a call that may still be running.', {
      ...described,
      settlesAfterSeconds: Math.round((options.callTimeoutMs + callSettleMarginMs) / 1000),
    })
    throw new PlannerFailure('PROVIDER_TEMPORARY')
  }
  const marked = await client.query(
    "UPDATE monthly_ai_runs SET status='failed',error_code=$1,completed_at=now() WHERE id=$2 AND status=$3",
    [interruptedRunCode, runId, run.status],
  )
  // Another run settled it first; the stage is read again on its next step.
  if (!marked.rowCount) throw new PlannerFailure('PROVIDER_TEMPORARY')
  const releasedCredits = await releaseInterruptedCredits(client, runId, attempt, run, options)
  console.info('A call that was cut off is settled and its stage will be called again.', {
    ...described,
    releasedCredits,
  })
  run.status = 'failed'
  run.error_code = interruptedRunCode
  return run
}

async function releaseInterruptedCredits(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  attempt: number,
  run: StoredRun,
  options: { businessId: string; reserveKeyPrefix: string; releaseKeyPrefix: string; usageKind: CreditUsageKind },
) {
  const reservation = await client.query<{ credits: string | null }>(
    "SELECT metadata->>'credits' AS credits FROM credit_ledger WHERE organization_id=$1 AND idempotency_key=$2 AND event_type='reserve'",
    [options.businessId, attemptKey(options.reserveKeyPrefix, runId, attempt)],
  )
  // A platform cost reserves nothing from the business.
  const reserved = reservation.rows[0]
  if (!reserved) return 0
  // A reservation written before its size was recorded is the run's reserved
  // cost in credits, as it was worked out when the call was made.
  const held = reserved.credits !== null
    ? Number(reserved.credits)
    : await creditsForCost(client, Number(run.reserved_cost_micro_eur || 0))
  // A new credit period clears what was reserved in the last one.
  const balance = await client.query<{ reserved_credits: number | string }>(
    'SELECT reserved_credits FROM credit_balances WHERE organization_id=$1',
    [options.businessId],
  )
  const credits = Math.min(held, Number(balance.rows[0]?.reserved_credits || 0))
  if (credits < 1) return 0
  await releaseReservedCredits(client as PoolClient, {
    organizationId: options.businessId,
    credits,
    usageKind: options.usageKind,
    referenceType: 'monthly_ai_run',
    referenceId: runId,
    idempotencyKey: attemptKey(options.releaseKeyPrefix, runId, attempt),
  })
  return credits
}
