import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

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
})

export type AdminBillingInvoicesQuery = z.infer<typeof adminBillingInvoicesQuerySchema>

export async function adminBillingInvoices(query: AdminBillingInvoicesQuery) {
  const { data, error } = await adminServiceClient().rpc('admin_billing_invoices', {
    p_page: query.page ?? 1,
    p_per_page: query.per_page ?? 50,
    p_org_id: query.org_id ?? null,
    p_kind: query.kind ?? null,
    p_source_type: query.source_type ?? null,
    p_from: query.from ? `${query.from}T00:00:00Z` : null,
    p_to: query.to ? `${query.to}T00:00:00Z` : null,
  })
  if (error) {
    console.error('Admin billing invoices query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.INVOICES_LOAD_FAILED' })
  }
  return data as {
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
    }>
    summary: {
      total_revenue_cents: number
      total_credit_notes_cents: number
      gross_revenue_cents: number
      net_revenue_cents: number
      vat_cents: number
      this_month_cents: number
      this_month_net_cents: number
    }
    total: number
    page: number
  }
}
