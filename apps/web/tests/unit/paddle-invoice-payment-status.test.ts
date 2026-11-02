import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A Paddle payment's invoice opens paid; its status must come from Paddle, not
// from the superadmin. The migration needs a database, so its text is checked.
const sql = readFileSync(
  new URL('../../database/migrations/20261102120000_paddle_invoices_payment_from_paddle.sql', import.meta.url),
  'utf8',
)

describe('Paddle invoice payment status', () => {
  it('refuses a manual change to an invoice Paddle paid', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_set_invoice_payment'))
    const guard = body.indexOf('INVOICE_PAYMENT_MANAGED_BY_PADDLE')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(body.indexOf('UPDATE public.invoice_payments'))
    expect(body).toContain('paddle_order.paddle_transaction_id = invoice.source_reference')
  })

  it('tells the invoice list which invoices Paddle paid', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_billing_invoices'))
    expect(body).toContain('AS paid_by_paddle')
    expect(body).toContain('payment_note, paid_by_paddle')
  })
})
