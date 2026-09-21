import { adminChangeBody, invoiceSettingsChangesSchema, updateInvoiceSettings } from '../../../utils/admin-plans'

export default defineEventHandler(async (event) => {
  const changes = await adminChangeBody(event, invoiceSettingsChangesSchema)
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updateInvoiceSettings({ id: actor.id, email: actor.email }, changes)
})
