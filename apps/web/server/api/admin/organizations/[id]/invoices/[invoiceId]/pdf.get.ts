import { z } from 'zod'
import { adminOrganizationInvoice } from '../../../../../../utils/admin-invoices'
import { invoicePdf } from '../../../../../../utils/invoice-pdf'
import { adminServiceClient } from '../../../../../../utils/admin-supabase'

export default defineEventHandler(async (event) => {
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const invoiceId = z.uuid().safeParse(getRouterParam(event, 'invoiceId'))
  const invoice = organizationId.success && invoiceId.success
    ? await adminOrganizationInvoice(organizationId.data, invoiceId.data)
    : null
  if (!invoice) throw createError({ statusCode: 404, message: 'server.INVOICE_NOT_FOUND' })
  setHeader(event, 'Content-Type', 'application/pdf')
  // ?inline=1 shows the PDF in the browser (preview) instead of downloading it.
  const disposition = getQuery(event).inline === '1' ? 'inline' : 'attachment'
  setHeader(event, 'Content-Disposition', `${disposition}; filename="${invoice.number}.pdf"`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  // The admin preview embeds this PDF in an iframe on the same origin; the
  // site-wide DENY would block it, while other sites still cannot frame it.
  setHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
  const payment = await adminServiceClient()
    .from('invoice_payments')
    .select('status, due_at, paid_at')
    .eq('invoice_id', invoice.id)
    .maybeSingle()
  if (payment.error) {
    console.error('Invoice payment read failed.', { code: payment.error.code, message: payment.error.message })
    throw createError({ statusCode: 502, message: 'server.INVOICE_LOAD_FAILED' })
  }
  return invoicePdf(invoice, payment.data && {
    status: payment.data.status === 'paid' ? 'paid' : 'unpaid',
    dueAt: payment.data.due_at,
    paidAt: payment.data.paid_at,
  })
})
