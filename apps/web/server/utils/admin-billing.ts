import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'
import { adminCurrency, sumInCurrency } from './admin-currency'

export const invoicePaymentFilters = ['paid', 'unpaid', 'overdue', 'credited'] as const

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)))

export const adminBillingInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(200).optional(),
  org_id: z.string().uuid().optional(),
  kind: z.enum(['invoice', 'credit_note']).optional(),
  source_type: z.enum(['subscription_activation', 'subscription_upgrade', 'credit_top_up', 'credit_note', 'custom_package', 'video_purchase']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  payment: z.enum(invoicePaymentFilters).optional(),
})

export const invoicePaymentMethods = ['cash', 'bank_transfer', 'card', 'other'] as const

export const invoicePaymentChangeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('paid'),
    paid_at: isoDate,
    method: z.enum(invoicePaymentMethods),
    note: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({ status: z.literal('unpaid') }).strict(),
])

const paymentFailures: Record<string, { statusCode: number; message: string }> = {
  INVOICE_PAYMENT_NOT_FOUND: { statusCode: 404, message: 'server.INVOICE_NOT_FOUND' },
  INVOICE_PAYMENT_INVALID: { statusCode: 400, message: 'server.VALUES_INVALID' },
}

/** Records a payment on an invoice, or clears one recorded by mistake. */
export async function setInvoicePayment(
  actor: { id: string; email: string },
  invoiceId: string,
  change: z.infer<typeof invoicePaymentChangeSchema>,
) {
  const paid = change.status === 'paid' ? change : null
  const { data, error } = await adminServiceClient().rpc('admin_set_invoice_payment', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_invoice_id: invoiceId,
    p_status: change.status,
    p_paid_at: paid ? `${paid.paid_at}T12:00:00Z` : null,
    p_method: paid?.method ?? null,
    p_note: paid?.note ?? null,
  })
  if (error) {
    const failure = paymentFailures[error.message]
    if (failure)
      throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: error.message } })
    console.error('Admin invoice payment update failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.SETTINGS_NOT_SAVED' })
  }
  return data as Record<string, unknown>
}

export type AdminBillingInvoicesQuery = z.infer<typeof adminBillingInvoicesQuerySchema>

const summaryFields = ['gross_revenue_cents', 'net_revenue_cents', 'vat_cents', 'outstanding_cents', 'overdue_cents'] as const

export async function adminBillingInvoices(query: AdminBillingInvoicesQuery) {
  const filters = {
    p_org_id: query.org_id ?? null,
    p_kind: query.kind ?? null,
    p_source_type: query.source_type ?? null,
    p_from: query.from ? `${query.from}T00:00:00Z` : null,
    p_to: query.to ? `${query.to}T00:00:00Z` : null,
  }
  const [byCurrency, currency] = await Promise.all([
    adminServiceClient().rpc('admin_billing_summary_by_currency', filters),
    adminCurrency(),
  ])
  if (byCurrency.error) {
    console.error('Admin billing summary query failed.', { code: byCurrency.error.code, message: byCurrency.error.message })
    throw createError({ statusCode: 502, message: 'server.INVOICES_LOAD_FAILED' })
  }
  // Each currency is converted before it is added, so the tiles show real money.
  const summary = await sumInCurrency(
    (Array.isArray(byCurrency.data) ? byCurrency.data : []) as Array<Record<string, unknown>>,
    summaryFields,
    currency,
  )
  const { data, error } = await adminServiceClient().rpc('admin_billing_invoices', {
    p_page: query.page ?? 1,
    p_per_page: query.per_page ?? 50,
    p_org_id: query.org_id ?? null,
    p_kind: query.kind ?? null,
    p_source_type: query.source_type ?? null,
    p_from: query.from ? `${query.from}T00:00:00Z` : null,
    p_to: query.to ? `${query.to}T00:00:00Z` : null,
    p_payment: query.payment ?? null,
  })
  if (error) {
    console.error('Admin billing invoices query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.INVOICES_LOAD_FAILED' })
  }
  const page = data as {
    invoices: Array<{
      id: string
      number: string
      kind: 'invoice' | 'credit_note'
      status: string
      issued_at: string
      organization_id: string
      organization_name: string
      total_cents: number
      subtotal_cents: number
      vat_cents: number
      source_type: string
      currency: string
      lines: unknown[]
      payment_status: (typeof invoicePaymentFilters)[number] | null
      due_at: string | null
      paid_at: string | null
      payment_method: (typeof invoicePaymentMethods)[number] | null
      payment_note: string | null
    }>
    summary: {
      total_revenue_cents: number
      total_credit_notes_cents: number
      gross_revenue_cents: number
      net_revenue_cents: number
      vat_cents: number
      outstanding_cents: number
      overdue_cents: number
      this_month_cents: number
      this_month_net_cents: number
    }
    total: number
    page: number
  }
  return { ...page, summary: { ...page.summary, ...summary }, summary_currency: currency }
}
