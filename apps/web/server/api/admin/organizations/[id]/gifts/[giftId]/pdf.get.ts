import { z } from 'zod'
import { adminGiftConfirmation } from '../../../../../../utils/admin-gifts'
import { invoicePdf } from '../../../../../../utils/invoice-pdf'
import { loadPdfAssets } from '../../../../../../utils/pdf-assets'

export default defineEventHandler(async (event) => {
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const giftId = z.uuid().safeParse(getRouterParam(event, 'giftId'))
  const confirmation = organizationId.success && giftId.success
    ? await adminGiftConfirmation(organizationId.data, giftId.data)
    : null
  if (!confirmation) throw createError({ statusCode: 404, message: 'server.INVOICE_NOT_FOUND' })
  setHeader(event, 'Content-Type', 'application/pdf')
  const disposition = getQuery(event).inline === '1' ? 'inline' : 'attachment'
  setHeader(event, 'Content-Disposition', `${disposition}; filename="${confirmation.gift.reference}.pdf"`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  // Shown in the admin preview iframe, like the invoices.
  setHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
  await loadPdfAssets()
  return invoicePdf(confirmation.document, null, confirmation.gift)
})
