import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The migrations need a database, so their text is checked, as is the order the
// webhook calls them in.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const verify = read('../../database/migrations/20261103140000_verify_paddle_payment.sql')
const quantity = read('../../database/migrations/20261103120000_paddle_adjusted_quantity_amount.sql')
const webhook = read('../../server/api/webhooks/paddle.post.ts')
const payment = read('../../server/api/billing/package-payment.post.ts')

describe('Paddle payment verification', () => {
  it('grants an order only for its latest transaction, currency and amount', () => {
    expect(verify).toContain('payment_order.paddle_transaction_id IS DISTINCT FROM p_transaction_id')
    expect(verify).toContain('pg_catalog.upper(payment_order.currency) <> pg_catalog.upper(COALESCE(p_currency, \'\'))')
    expect(verify).toContain('p_subtotal_cents IS DISTINCT FROM payment_order.amount_cents::bigint')
  })

  it('leaves an order already paid to the payment function', () => {
    expect(verify.indexOf('IF payment_order.status = \'paid\' THEN RETURN; END IF;'))
      .toBeLessThan(verify.indexOf('paddle_transaction_id IS DISTINCT FROM'))
  })

  it('checks after a changed quantity is synced and before anything is granted', () => {
    const sync = webhook.indexOf('app.sync_paddle_adjusted_quantity')
    const check = webhook.indexOf('app.verify_paddle_payment')
    expect(sync).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(sync)
    expect(webhook.indexOf('app.process_paddle_payment')).toBeGreaterThan(check)
  })

  it('compares the subtotal, so a discount code still passes', () => {
    expect(webhook).toContain('data.details?.totals?.subtotal')
    expect(webhook).not.toContain('totals?.total')
  })

  it('keeps the amount in step with a changed quantity', () => {
    expect(quantity).toContain('amount_cents=unit_cents * p_quantity')
    expect(quantity).toContain('price_cents=unit_cents * p_quantity')
  })

  it('rewrites a reused pending order from the current offer', () => {
    expect(payment).toMatch(/UPDATE paddle_payment_orders\s+SET posts_included=\$2,videos_included=\$3,credits_included=\$4,amount_cents=\$5,currency=\$6/)
  })
})
