import { describe, expect, it, vi } from 'vitest'
import { formatInvoiceMoney, invoicePdf } from '../../server/utils/invoice-pdf'
import { addVat, formatInvoiceNumber, issueInvoice } from '../../server/utils/invoices'
import { annualPriceCents } from '../../server/utils/subscriptions'

const organizationId = '00000000-0000-4000-8000-000000000001'

/** An in-memory invoices table and gapless per-year counter. */
function invoiceClient(vatRateBasisPoints = 0) {
  const rows: Array<Record<string, unknown>> = []
  let counter = 122
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM invoices WHERE organization_id=$1 AND source_type'))
      return { rows: rows.filter(row => row.source_type === values[1] && row.source_reference === values[2]) }
    if (sql.includes('FROM invoice_settings'))
      return { rows: [{ number_prefix: 'RRIT', seller_name: 'Rrit', seller_address: 'Prishtinë', seller_fiscal_number: '', vat_rate_basis_points: vatRateBasisPoints }] }
    if (sql.includes('FROM organizations'))
      return { rows: [{ name: 'Hamza Rent a Car', legal_name: null, address: 'Rr. Dëshmorët', city: 'Rahovec', country: 'Kosovë', fiscal_number: '811234567' }] }
    if (sql.includes('app.next_invoice_sequence')) return { rows: [{ sequence: ++counter }] }
    if (sql.startsWith('INSERT INTO invoices')) {
      const row = {
        id: `invoice-${rows.length + 1}`, number: values[1], kind: values[4], credited_invoice_id: values[5], status: 'paid',
        issued_at: values[6], currency: 'EUR', seller: JSON.parse(String(values[7])), buyer: JSON.parse(String(values[8])),
        lines: JSON.parse(String(values[9])), subtotal_cents: values[10], vat_rate_basis_points: values[11], vat_cents: values[12],
        total_cents: values[13], source_type: values[14], source_reference: values[15],
      }
      rows.push(row)
      return { rows: [row] }
    }
    return { rows: [] }
  })
  return { query, rows }
}

const annualPackage1 = (client: ReturnType<typeof invoiceClient>, reference = 'subscription-1') =>
  issueInvoice(client as never, {
    organizationId,
    sourceType: 'subscription_activation',
    sourceReference: reference,
    lines: [{ description: 'Pako 1 · annual subscription (12 months)', quantity: 1, unitPriceCents: annualPriceCents(2499, 15) }],
    now: new Date('2026-09-18T10:00:00Z'),
  })

describe('invoice numbering', () => {
  it('formats a gapless yearly number', () => {
    expect(formatInvoiceNumber('RRIT', 2026, 123)).toBe('RRIT-2026-000123')
  })

  it('gives two consecutive invoices consecutive numbers', async () => {
    const client = invoiceClient()
    const first = await annualPackage1(client, 'subscription-1')
    const second = await annualPackage1(client, 'subscription-2')
    expect([first.number, second.number]).toEqual(['RRIT-2026-000123', 'RRIT-2026-000124'])
  })

  it('returns the same invoice for a repeated payment confirmation without using a number', async () => {
    const client = invoiceClient()
    const first = await annualPackage1(client)
    const again = await annualPackage1(client)
    expect(again.number).toBe(first.number)
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes('next_invoice_sequence'))).toHaveLength(1)
  })
})

describe('invoice amounts', () => {
  it('invoices an annual Package 1 at EUR 254.90', async () => {
    const invoice = await annualPackage1(invoiceClient())
    expect(invoice.total).toBe(254.9)
    expect(invoice.buyer).toMatchObject({ name: 'Hamza Rent a Car', fiscalNumber: '811234567' })
  })

  it('invoices 500 extra credits at EUR 10.00', async () => {
    const invoice = await issueInvoice(invoiceClient() as never, {
      organizationId,
      sourceType: 'credit_top_up',
      sourceReference: 'purchase',
      lines: [{ description: 'Additional AI credits', quantity: 500, unitPriceCents: 2 }],
    })
    expect(invoice.total).toBe(10)
    expect(invoice.lines[0]).toMatchObject({ quantity: 500, unitPriceCents: 2, totalCents: 1000 })
  })

  it('adds VAT on top of the net price', () => {
    expect(addVat(1000, 0)).toEqual({ subtotalCents: 1000, vatCents: 0, totalCents: 1000 })
    expect(addVat(2499, 1800)).toEqual({ subtotalCents: 2499, vatCents: 450, totalCents: 2949 })
    expect(addVat(-2499, 1800)).toEqual({ subtotalCents: -2499, vatCents: -450, totalCents: -2949 })
  })
})

describe('invoice PDF', () => {
  it('contains the number, date, items and amount', async () => {
    const invoice = await annualPackage1(invoiceClient())
    const pdf = invoicePdf(invoice).toString('latin1')
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(pdf).toContain('RRIT-2026-000123')
    expect(pdf).toContain('18.09.2026')
    // PDF strings escape parentheses.
    expect(pdf).toContain(String.raw`Pako 1 · annual subscription \(12 months\)`)
    expect(pdf).toContain('\x80254.90')
    expect(pdf).toContain('Hamza Rent a Car')
  })

  it('formats euro amounts the Albanian way', () => {
    expect(formatInvoiceMoney(1234.5)).toBe('€1,234.50')
    expect(formatInvoiceMoney(-10)).toBe('-€10.00')
  })
})
