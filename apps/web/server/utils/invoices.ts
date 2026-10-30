import type { PoolClient } from 'pg'

export type InvoiceSourceType = 'subscription_activation' | 'subscription_upgrade' | 'credit_top_up' | 'credit_note'
export type InvoiceLine = { description: string; quantity: number; unitPriceCents: number; totalCents: number }
export type InvoiceParty = { name: string; address: string; city?: string; country?: string; fiscalNumber: string }
export type BillingDetails = { legalName: string; address: string; city: string; country: string; fiscalNumber: string }

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

/** FRAMIC-2026-000123: prefix, year of issue and a gapless per-year sequence. */
export function formatInvoiceNumber(prefix: string, year: number, sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('sequence must be a positive integer')
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`
}

/**
 * Prices are net: VAT is added on top. A 24,99 € plan at 18% VAT is invoiced
 * as 24,99 € + 4,50 € VAT = 29,49 €. Credit notes (negative amounts) round the
 * same way as the invoice they reverse, so the two always cancel out exactly.
 */
export function addVat(subtotalCents: number, vatRateBasisPoints: number) {
  if (!Number.isSafeInteger(subtotalCents)) throw new Error('subtotalCents must be an integer')
  if (!Number.isInteger(vatRateBasisPoints) || vatRateBasisPoints < 0 || vatRateBasisPoints > 10000)
    throw new Error('vatRateBasisPoints must be between 0 and 10000')
  const vatCents = Math.sign(subtotalCents) * Math.round((Math.abs(subtotalCents) * vatRateBasisPoints) / 10000)
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents }
}

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

export async function billingDetails(client: Pick<PoolClient, 'query'>, organizationId: string): Promise<BillingDetails> {
  const result = await client.query<{ name: string; legal_name: string | null; address: string | null; city: string | null; country: string | null; fiscal_number: string | null }>(
    `SELECT o.name,d.legal_name,d.address,d.city,d.country,d.fiscal_number
       FROM organizations o LEFT JOIN organization_billing_details d ON d.organization_id=o.id
      WHERE o.id=$1`,
    [organizationId],
  )
  const row = result.rows[0]
  return {
    legalName: row?.legal_name || row?.name || '',
    address: row?.address || '',
    city: row?.city || '',
    country: row?.country || '',
    fiscalNumber: row?.fiscal_number || '',
  }
}

/**
 * Issues an invoice inside the purchase transaction. The source reference
 * makes it idempotent: repeating a confirmation returns the existing invoice
 * and never consumes a second number.
 */
export async function issueInvoice(client: PoolClient, input: {
  organizationId: string
  sourceType: InvoiceSourceType
  sourceReference: string
  lines: Array<{ description: string; quantity: number; unitPriceCents: number }>
  creditedInvoiceId?: string
  now?: Date
}) {
  const existing = await client.query<InvoiceRow>(
    `SELECT ${invoiceColumns} FROM invoices WHERE organization_id=$1 AND source_type=$2 AND source_reference=$3`,
    [input.organizationId, input.sourceType, input.sourceReference],
  )
  if (existing.rows[0]) return toInvoice(existing.rows[0])
  const lines: InvoiceLine[] = input.lines.map(line => ({ ...line, totalCents: line.quantity * line.unitPriceCents }))
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0)
  const settings = await client.query<{ number_prefix: string; seller_name: string; seller_address: string; seller_fiscal_number: string; vat_rate_basis_points: number }>(
    'SELECT number_prefix,seller_name,seller_address,seller_fiscal_number,vat_rate_basis_points FROM invoice_settings WHERE singleton=true',
  )
  const config = settings.rows[0]
  if (!config) throw new Error('Invoice settings are not configured.')
  const buyer = await billingDetails(client, input.organizationId)
  const amounts = addVat(subtotalCents, Number(config.vat_rate_basis_points))
  const issuedAt = input.now || new Date()
  const year = issuedAt.getUTCFullYear()
  const sequence = await client.query<{ sequence: number }>('SELECT app.next_invoice_sequence($1) AS sequence', [year])
  const number = formatInvoiceNumber(config.number_prefix, year, Number(sequence.rows[0]!.sequence))
  const created = await client.query<InvoiceRow>(
    `INSERT INTO invoices(organization_id,number,year,sequence,kind,credited_invoice_id,issued_at,seller,buyer,lines,
       subtotal_cents,vat_rate_basis_points,vat_cents,total_cents,source_type,source_reference)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING ${invoiceColumns}`,
    [
      input.organizationId, number, year, Number(sequence.rows[0]!.sequence),
      input.creditedInvoiceId ? 'credit_note' : 'invoice', input.creditedInvoiceId || null, issuedAt,
      JSON.stringify({ name: config.seller_name, address: config.seller_address, fiscalNumber: config.seller_fiscal_number }),
      JSON.stringify({ name: buyer.legalName, address: buyer.address, city: buyer.city, country: buyer.country, fiscalNumber: buyer.fiscalNumber }),
      JSON.stringify(lines), amounts.subtotalCents, Number(config.vat_rate_basis_points), amounts.vatCents, amounts.totalCents,
      input.sourceType, input.sourceReference,
    ],
  )
  return toInvoice(created.rows[0]!)
}

/** A correction: a credit note that reverses the whole original invoice. */
export async function issueCreditNote(client: PoolClient, input: { organizationId: string; invoiceId: string; reason: string }) {
  const original = await invoiceById(client, input.organizationId, input.invoiceId)
  if (!original || original.kind !== 'invoice') throw new Error('Only an issued invoice can be credited.')
  return issueInvoice(client, {
    organizationId: input.organizationId,
    sourceType: 'credit_note',
    sourceReference: original.id,
    creditedInvoiceId: original.id,
    lines: original.lines.map(line => ({
      description: `${input.reason}: ${original.number} · ${line.description}`,
      quantity: line.quantity,
      unitPriceCents: -line.unitPriceCents,
    })),
  })
}

export async function listInvoices(client: Pick<PoolClient, 'query'>, organizationId: string) {
  const result = await client.query<InvoiceRow>(
    `SELECT ${invoiceColumns} FROM invoices WHERE organization_id=$1 ORDER BY issued_at DESC, sequence DESC LIMIT 200`,
    [organizationId],
  )
  return result.rows.map(toInvoice)
}
export async function invoiceById(client: Pick<PoolClient, 'query'>, organizationId: string, invoiceId: string) {
  const result = await client.query<InvoiceRow>(
    `SELECT ${invoiceColumns} FROM invoices WHERE organization_id=$1 AND id=$2`,
    [organizationId, invoiceId],
  )
  return result.rows[0] ? toInvoice(result.rows[0]) : null
}
