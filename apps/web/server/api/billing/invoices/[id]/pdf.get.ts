import { z } from 'zod'
import { invoicePdf } from '../../../../utils/invoice-pdf'
import { invoiceById } from '../../../../utils/invoices'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Fatura nuk u gjet.' })
  const invoice = await withBusinessTransaction(user.id, (client, business) =>
    invoiceById(client, business.id, id.data),
  )
  if (!invoice) throw createError({ statusCode: 404, message: 'Fatura nuk u gjet.' })
  setHeader(event, 'Content-Type', 'application/pdf')
  // ?inline=1 shows the PDF in the browser (preview) instead of downloading it.
  const disposition = getQuery(event).inline === '1' ? 'inline' : 'attachment'
  setHeader(event, 'Content-Disposition', `${disposition}; filename="${invoice.number}.pdf"`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return invoicePdf(invoice)
})
