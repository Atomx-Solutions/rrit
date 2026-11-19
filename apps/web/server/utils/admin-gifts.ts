import { adminServiceClient } from './admin-supabase'
import type { Invoice, InvoiceParty } from './invoices'
import type { GiftConfirmation } from './invoice-pdf'

/**
 * A gift laid out like an invoice so it can be confirmed on the invoice PDF:
 * same seller, the client's billing details, the value given. It takes its
 * own number in the invoice series but is never stored as an invoice.
 */
export async function adminGiftConfirmation(organizationId: string, giftId: string)
  : Promise<{ document: Invoice, gift: GiftConfirmation } | null> {
  const client = adminServiceClient()
  const [gift, settings, organization, details] = await Promise.all([
    client.from('package_gifts').select('id, number, value_cents, currency, description, reason, created_at')
      .eq('organization_id', organizationId).eq('id', giftId).maybeSingle(),
    client.from('invoice_settings').select('seller_name, seller_address, seller_fiscal_number')
      .eq('singleton', true).maybeSingle(),
    client.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
    client.from('organization_billing_details').select('legal_name, address, city, country, fiscal_number')
      .eq('organization_id', organizationId).maybeSingle(),
  ])
  const failed = gift.error || settings.error || organization.error || details.error
  if (failed) {
    console.error('Gift confirmation read failed.', { code: failed.code, message: failed.message })
    throw createError({ statusCode: 502, message: 'server.INVOICE_LOAD_FAILED' })
  }
  if (!gift.data) return null
  const seller: InvoiceParty = {
    name: settings.data?.seller_name ?? '',
    address: settings.data?.seller_address ?? '',
    fiscalNumber: settings.data?.seller_fiscal_number ?? '',
  }
  const buyer: InvoiceParty = {
    name: details.data?.legal_name || organization.data?.name || '',
    address: details.data?.address ?? '',
    city: details.data?.city ?? '',
    country: details.data?.country ?? '',
    fiscalNumber: details.data?.fiscal_number ?? '',
  }
  const value = gift.data.value_cents
  return {
    document: {
      id: gift.data.id,
      number: gift.data.number,
      kind: 'invoice',
      creditedInvoiceId: null,
      status: 'gift',
      issuedAt: new Date(gift.data.created_at).toISOString(),
      currency: gift.data.currency,
      seller,
      buyer,
      lines: [{ description: gift.data.description, quantity: 1, unitPriceCents: value, totalCents: value }],
      subtotal: value / 100,
      vatRate: 0,
      vat: 0,
      total: value / 100,
    },
    gift: { reference: gift.data.number, reason: gift.data.reason },
  }
}
