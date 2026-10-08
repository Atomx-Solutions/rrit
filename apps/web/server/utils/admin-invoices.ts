import { adminServiceClient } from './admin-supabase'
import { invoiceColumns, toInvoice, type InvoiceRow } from './invoices'

// Service-role reads of one organization's invoices for the superadmin; the
// organization is always part of the filter, never taken from the invoice.
export async function adminOrganizationInvoices(organizationId: string) {
  const { data, error } = await adminServiceClient()
    .from('invoices')
    .select(invoiceColumns.replace(/\s+/g, ''))
    .eq('organization_id', organizationId)
    .order('issued_at', { ascending: false })
    .order('sequence', { ascending: false })
    .limit(200)
  if (error) {
    console.error('Admin invoice list failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.INVOICES_LOAD_FAILED' })
  }
  return ((data || []) as unknown as InvoiceRow[]).map(toInvoice)
}

export async function adminOrganizationInvoice(organizationId: string, invoiceId: string) {
  const { data, error } = await adminServiceClient()
    .from('invoices')
    .select(invoiceColumns.replace(/\s+/g, ''))
    .eq('organization_id', organizationId)
    .eq('id', invoiceId)
    .maybeSingle()
  if (error) {
    console.error('Admin invoice read failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.INVOICE_LOAD_FAILED' })
  }
  return data ? toInvoice(data as unknown as InvoiceRow) : null
}
