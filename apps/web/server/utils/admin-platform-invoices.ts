import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD).').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Expected a valid ISO date.')

export const adminPlatformInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(25),
  org_id: z.string().uuid().optional(),
  kind: z.enum(['invoice', 'credit_note']).optional(),
  source_type: z.enum(['subscription_activation', 'subscription_upgrade', 'credit_top_up', 'credit_note']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'The end date must be on or after the start date.',
    })
  }
})

export type AdminPlatformInvoicesQuery = z.infer<typeof adminPlatformInvoicesQuerySchema>
export type AdminPlatformInvoice = {
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
}
export type AdminPlatformInvoicesPage = {
  invoices: AdminPlatformInvoice[]
  summary: {
    total_revenue_cents: number
    total_credit_notes_cents: number
    net_revenue_cents: number
    this_month_cents: number
  }
  total: number
  page: number
  per_page: number
}

function number(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeAdminPlatformInvoices(value: unknown, query: AdminPlatformInvoicesQuery): AdminPlatformInvoicesPage {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const summary = (data.summary && typeof data.summary === 'object' ? data.summary : {}) as Record<string, unknown>
  const invoices = Array.isArray(data.invoices) ? data.invoices as AdminPlatformInvoice[] : []
  return {
    invoices: invoices.map(invoice => ({
      ...invoice,
      total_cents: number(invoice.total_cents),
      subtotal_cents: number(invoice.subtotal_cents),
      vat_cents: number(invoice.vat_cents),
      lines: Array.isArray(invoice.lines) ? invoice.lines : [],
    })),
    summary: {
      total_revenue_cents: number(summary.total_revenue_cents),
      total_credit_notes_cents: number(summary.total_credit_notes_cents),
      net_revenue_cents: number(summary.net_revenue_cents),
      this_month_cents: number(summary.this_month_cents),
    },
    total: number(data.total),
    page: number(data.page) || query.page,
    per_page: number(data.per_page) || query.per_page,
  }
}

export async function adminPlatformInvoices(query: AdminPlatformInvoicesQuery) {
  const { data, error } = await adminServiceClient().rpc('admin_platform_invoices', {
    p_page: query.page,
    p_per_page: query.per_page,
    p_org_id: query.org_id ?? null,
    p_kind: query.kind ?? null,
    p_source_type: query.source_type ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  })
  if (error) {
    console.error('Admin platform invoices query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'Faturat administrative nuk u ngarkuan.' })
  }
  return normalizeAdminPlatformInvoices(data, query)
}
