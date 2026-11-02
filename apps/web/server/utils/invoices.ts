export type InvoiceLine = { description: string; quantity: number; unitPriceCents: number; totalCents: number }
export type InvoiceParty = { name: string; address: string; city?: string; country?: string; fiscalNumber: string }

export type InvoiceRow = {
  id: string
  number: string
  kind: 'invoice' | 'credit_note'
  credited_invoice_id: string | null
  status: string
  issued_at: Date
  currency: string
  seller: InvoiceParty
  buyer: InvoiceParty
  lines: InvoiceLine[]
  subtotal_cents: number
  vat_rate_basis_points: number
  vat_cents: number
  total_cents: number
}

export const invoiceColumns = `id,number,kind,credited_invoice_id,status,issued_at,currency,seller,buyer,lines,
  subtotal_cents,vat_rate_basis_points,vat_cents,total_cents`

export function toInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    creditedInvoiceId: row.credited_invoice_id,
    status: row.status,
    issuedAt: new Date(row.issued_at).toISOString(),
    currency: row.currency,
    seller: row.seller,
    buyer: row.buyer,
    lines: row.lines,
    subtotal: row.subtotal_cents / 100,
    vatRate: row.vat_rate_basis_points / 100,
    vat: row.vat_cents / 100,
    total: row.total_cents / 100,
  }
}
export type Invoice = ReturnType<typeof toInvoice>
