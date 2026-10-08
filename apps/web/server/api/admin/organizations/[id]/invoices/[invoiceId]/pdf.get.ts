import { z } from 'zod'
import { adminOrganizationInvoice } from '../../../../../../utils/admin-invoices'
import { invoicePdf } from '../../../../../../utils/invoice-pdf'

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
  return invoicePdf(invoice)
})
