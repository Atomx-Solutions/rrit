import type { Pool, PoolClient } from 'pg'
import { expireRemainingCredits, grantAdditionalCredits, grantMonthlyCredits } from './credits'
import { issueInvoice } from './invoices'

export type BillingInterval = 'monthly' | 'annual'
export type PlanChange = 'upgrade' | 'downgrade' | 'unchanged'

type PlanRow = {
  code: string
  name: string
  monthly_cents: number
  monthly_credits: number
  annual_discount_percent: number
}

type SubscriptionRow = {
  id: string
  organization_id: string
  plan_code: string
  billing_interval: BillingInterval
  status: string
  current_period_start: Date
  current_period_end: Date
  pending_plan_code: string | null
}

function planInvoiceLabel(plan: PlanRow, interval: BillingInterval) {
  return `${plan.name} · ${interval === 'annual' ? 'annual subscription (12 months)' : 'monthly subscription'}`
}

function billingError(statusCode: number, code: string, message: string) {
  return createError({ statusCode, message, data: { code } })
}

/** Annual price = monthly price x 12 x (1 - discount), rounded to the cent. */
export function annualPriceCents(monthlyCents: number, discountPercent: number) {
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 0)
    throw new Error('monthlyCents must be a non-negative integer')
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100)
    throw new Error('discountPercent must be between 0 and 100')
  return Math.round((monthlyCents * 12 * (100 - discountPercent)) / 100)
}

export function periodPriceCents(plan: PlanRow, interval: BillingInterval) {
  return interval === 'annual'
    ? annualPriceCents(plan.monthly_cents, plan.annual_discount_percent)
    : plan.monthly_cents
}

/** Adds calendar months in UTC, clamping to the last day of shorter months. */
export function addMonths(date: Date, months: number) {
  const day = date.getUTCDate()
  const result = new Date(date)
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/**
 * The monthly credit window of a subscription that contains `at`. Windows are
 * anchored to the subscription start, so a 31 January start refreshes on
 * 28/29 February and 31 March instead of drifting to the 28th forever.
 */
export function creditWindow(periodStart: Date, periodEnd: Date, at: Date) {
  let index = 0
  while (addMonths(periodStart, index + 1) <= at) index++
  const start = addMonths(periodStart, index)
  const next = addMonths(periodStart, index + 1)
  return { start, end: next < periodEnd ? next : periodEnd }
}

export function planChange(current: PlanRow, next: PlanRow): PlanChange {
  if (current.code === next.code) return 'unchanged'
  return next.monthly_cents > current.monthly_cents ? 'upgrade' : 'downgrade'
}

async function purchasablePlan(client: PoolClient, code: string) {
  const result = await client.query<PlanRow>(
    `SELECT code,name,monthly_cents,monthly_credits,annual_discount_percent
       FROM plans WHERE code=$1 AND active=true AND NOT is_trial`,
    [code],
  )
  const plan = result.rows[0]
  if (!plan) throw billingError(422, 'PLAN_UNAVAILABLE', 'server.PACKAGE_UNAVAILABLE')
  return plan
}

async function planByCode(client: PoolClient, code: string) {
  const result = await client.query<PlanRow>(
    'SELECT code,name,monthly_cents,monthly_credits,annual_discount_percent FROM plans WHERE code=$1',
    [code],
  )
  if (!result.rows[0]) throw new Error(`Plan ${code} does not exist.`)
  return result.rows[0]
}

async function currentSubscription(client: PoolClient, organizationId: string) {
  const result = await client.query<SubscriptionRow>(
    `SELECT id,organization_id,plan_code,billing_interval,status,
            current_period_start,current_period_end,pending_plan_code
       FROM subscriptions
      WHERE organization_id=$1 AND status IN ('trialing','active','past_due')
      FOR UPDATE`,
    [organizationId],
  )
  return result.rows[0]
}

/**
 * Starts a paid subscription. A running trial ends and its credits are
 * replaced by the first monthly allowance of the paid package. Payment
 * confirmation calls this; it must never run before the charge succeeds.
 */
export async function activateSubscription(
  client: PoolClient,
  input: { organizationId: string; planCode: string; interval: BillingInterval; now?: Date },
) {
  const now = input.now || new Date()
  const plan = await purchasablePlan(client, input.planCode)
  const current = await currentSubscription(client, input.organizationId)
  if (current && current.status !== 'trialing')
    throw billingError(409, 'SUBSCRIPTION_ACTIVE', 'Ke tashmë një abonim aktiv.')
  if (current)
    await client.query(
      "UPDATE subscriptions SET status='cancelled',updated_at=now() WHERE id=$1",
      [current.id],
    )
  const periodEnd = addMonths(now, input.interval === 'annual' ? 12 : 1)
  const created = await client.query<{ id: string }>(
    `INSERT INTO subscriptions
      (organization_id,plan_code,billing_interval,status,current_period_start,current_period_end,price_cents)
     VALUES($1,$2,$3,'active',$4,$5,$6)
     RETURNING id`,
    [
      input.organizationId,
      plan.code,
      input.interval,
      now,
      periodEnd,
      periodPriceCents(plan, input.interval),
    ],
  )
  const subscriptionId = created.rows[0]!.id
  const invoice = await issueInvoice(client, {
    organizationId: input.organizationId,
    sourceType: 'subscription_activation',
    sourceReference: subscriptionId,
    lines: [{ description: planInvoiceLabel(plan, input.interval), quantity: 1, unitPriceCents: periodPriceCents(plan, input.interval) }],
    now,
  })
  // Annual subscriptions also receive only one month of credits at a time.
  const window = creditWindow(now, periodEnd, now)
  await grantMonthlyCredits(client, {
    organizationId: input.organizationId,
    subscriptionId,
    monthlyCredits: plan.monthly_credits,
    periodStart: window.start,
    periodEnd: window.end,
  })
  return { subscriptionId, planCode: plan.code, interval: input.interval, invoiceNumber: invoice.number }
}

/**
 * An upgrade applies immediately and adds the allowance difference to the
 * current balance, so unused credits carry over until the monthly refresh.
 * A downgrade is scheduled for the next monthly refresh.
 */
export async function changeSubscriptionPlan(
  client: PoolClient,
  input: { organizationId: string; planCode: string },
) {
  const current = await currentSubscription(client, input.organizationId)
  if (!current || current.status === 'trialing')
    throw billingError(409, 'NO_ACTIVE_SUBSCRIPTION', 'Nuk ke abonim aktiv me pagesë.')
  const next = await purchasablePlan(client, input.planCode)
  const active = await planByCode(client, current.plan_code)
  const change = planChange(active, next)
  if (change === 'unchanged') {
    await client.query(
      'UPDATE subscriptions SET pending_plan_code=NULL,updated_at=now() WHERE id=$1',
      [current.id],
    )
    return { change, planCode: active.code, pendingPlanCode: null }
  }
  if (change === 'downgrade') {
    await client.query(
      'UPDATE subscriptions SET pending_plan_code=$2,updated_at=now() WHERE id=$1',
      [current.id, next.code],
    )
    return { change, planCode: active.code, pendingPlanCode: next.code }
  }
  await client.query(
    `UPDATE subscriptions
        SET plan_code=$2,pending_plan_code=NULL,price_cents=$3,updated_at=now()
      WHERE id=$1`,
    [current.id, next.code, periodPriceCents(next, current.billing_interval)],
  )
  const balance = await client.query<{ period_start: Date | null }>(
    'SELECT period_start FROM credit_balances WHERE organization_id=$1',
    [input.organizationId],
  )
  const periodKey = balance.rows[0]?.period_start
    ? new Date(balance.rows[0].period_start).toISOString()
    : 'unknown'
  // The upgrade is charged as the price difference of the billing period.
  const upgradeCents =
    periodPriceCents(next, current.billing_interval) - periodPriceCents(active, current.billing_interval)
  const invoice = upgradeCents > 0
    ? await issueInvoice(client, {
        organizationId: input.organizationId,
        sourceType: 'subscription_upgrade',
        sourceReference: `${current.id}:${periodKey}:${active.code}->${next.code}`,
        lines: [{ description: `Upgrade ${active.name} -> ${next.name} (${current.billing_interval === 'annual' ? 'annual' : 'monthly'})`, quantity: 1, unitPriceCents: upgradeCents }],
      })
    : null
  const additionalCredits = next.monthly_credits - active.monthly_credits
  if (additionalCredits > 0)
    await grantAdditionalCredits(client, {
      organizationId: input.organizationId,
      subscriptionId: current.id,
      credits: additionalCredits,
      referenceType: 'subscription_upgrade',
      referenceId: `${active.code}->${next.code}`,
      idempotencyKey: `credit-upgrade:${current.id}:${periodKey}:${active.code}->${next.code}`,
    })
  return { change, planCode: next.code, pendingPlanCode: null, invoiceNumber: invoice?.number ?? null }
}

async function refreshSubscription(client: PoolClient, subscriptionId: string, now: Date) {
  const locked = await client.query<SubscriptionRow & { balance_period_end: Date | null }>(
    `SELECT s.id,s.organization_id,s.plan_code,s.billing_interval,s.status,
            s.current_period_start,s.current_period_end,s.pending_plan_code,
            b.period_end AS balance_period_end
       FROM subscriptions s
       LEFT JOIN credit_balances b ON b.organization_id=s.organization_id
      WHERE s.id=$1 AND s.status IN ('active','past_due')
      FOR UPDATE OF s`,
    [subscriptionId],
  )
  const subscription = locked.rows[0]
  if (!subscription) return
  if (subscription.balance_period_end && subscription.balance_period_end > now) return

  // The paid period ended without a renewal: the package and its credits stop.
  if (subscription.current_period_end <= now) {
    await client.query("UPDATE subscriptions SET status='expired',updated_at=now() WHERE id=$1", [
      subscription.id,
    ])
    await expireRemainingCredits(client, {
      organizationId: subscription.organization_id,
      subscriptionId: subscription.id,
      idempotencyKey: `credit-expire-subscription:${subscription.id}`,
    })
    return
  }

  let planCode = subscription.plan_code
  if (subscription.pending_plan_code) {
    const pending = await planByCode(client, subscription.pending_plan_code)
    planCode = pending.code
    await client.query(
      `UPDATE subscriptions
          SET plan_code=$2,pending_plan_code=NULL,price_cents=$3,updated_at=now()
        WHERE id=$1`,
      [subscription.id, pending.code, periodPriceCents(pending, subscription.billing_interval)],
    )
  }
  const plan = await planByCode(client, planCode)
  const window = creditWindow(
    subscription.current_period_start,
    subscription.current_period_end,
    now,
  )
  await grantMonthlyCredits(client, {
    organizationId: subscription.organization_id,
    subscriptionId: subscription.id,
    monthlyCredits: plan.monthly_credits,
    periodStart: window.start,
    periodEnd: window.end,
  })
}

/**
 * Worker batch: starts each subscription's new monthly credit window, applies
 * scheduled downgrades and expires ended subscriptions. Each subscription is
 * processed in its own transaction; grants are idempotent per window.
 */
export async function refreshSubscriptionCredits(db: Pool, now = new Date()) {
  const due = await db.query<{ id: string }>(
    `SELECT s.id
       FROM subscriptions s
       LEFT JOIN credit_balances b ON b.organization_id=s.organization_id
      WHERE s.status IN ('active','past_due')
        AND (b.period_end IS NULL OR b.period_end<=$1 OR s.current_period_end<=$1)
      ORDER BY s.current_period_start
      LIMIT 500`,
    [now],
  )
  for (const row of due.rows) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await refreshSubscription(client, row.id, now)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      console.warn('Subscription credit refresh failed; it will be retried.', {
        subscriptionId: row.id,
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : typeof error,
      })
    } finally {
      client.release()
    }
  }
  return due.rows.length
}
