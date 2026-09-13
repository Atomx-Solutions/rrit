import type { Pool, PoolClient } from 'pg'

export const aiCreditCycleStartSql = `GREATEST(
  date_trunc('month',now()),
  COALESCE(
    (SELECT max(created_at) FROM audit_events
      WHERE business_id=$1 AND action='ai_credits.granted'),
    date_trunc('month',now())
  )
)`

function positiveInteger(name: string) {
  const value = Number(process.env[name])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} is not configured`)
  return value
}

export function aiCreditConfiguration() {
  return {
    limit: positiveInteger('AI_CREDIT_LIMIT'),
    budgetMicroEur: positiveInteger('AI_CREDIT_BUDGET_MICRO_EUR'),
  }
}

export function aiCreditBalance(spentMicroEur: number, limit: number, budgetMicroEur: number) {
  const spent = Math.max(0, Number.isFinite(spentMicroEur) ? spentMicroEur : 0)
  const available = Math.max(0, Math.floor(((budgetMicroEur - spent) * limit) / budgetMicroEur))
  const used = limit - available
  return {
    available,
    used,
    limit,
    percentage: Math.round((available / limit) * 100),
    state:
      available === 0
        ? ('exhausted' as const)
        : available <= limit * 0.2
          ? ('low' as const)
          : ('available' as const),
  }
}

export async function aiCreditSnapshot(businessId: string, db: Pool | PoolClient = database()) {
  const config = aiCreditConfiguration()
  const result = await db.query<{ spent: string }>(
    `WITH boundary AS (
      SELECT ${aiCreditCycleStartSql} AS started_at
    ), costs AS (
      SELECT COALESCE(actual_cost_micro_eur,reserved_cost_micro_eur) AS amount,created_at
        FROM monthly_ai_runs
       WHERE business_id=$1 AND status IN ('reserved','completed','uncertain')
      UNION ALL
      SELECT CASE WHEN status='committed' THEN actual_cost_micro_eur ELSE reserved_cost_micro_eur END,
             created_at
        FROM ai_cost_ledger
       WHERE business_id=$1 AND status IN ('reserved','committed')
    )
    SELECT COALESCE(sum(amount),0)::text AS spent
      FROM costs,boundary WHERE costs.created_at>=boundary.started_at`,
    [businessId],
  )
  return aiCreditBalance(Number(result.rows[0]?.spent || 0), config.limit, config.budgetMicroEur)
}
