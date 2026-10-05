import { adminPlansSettings } from '../../../utils/admin-plans'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const settings = await adminPlansSettings()
  const { plans, credit_pricing, invoice_settings } = settings as {
    plans: unknown
    credit_pricing: unknown
    invoice_settings: unknown
  }
  return { plans, credit_pricing, invoice_settings }
})
