import { describe, expect, it } from 'vitest'
import { formatInvoiceMoney, invoicePdf } from '../../server/utils/invoice-pdf'
import { toInvoice } from '../../server/utils/invoices'

/** An annual Package 1 invoice as the database stores it. */
const annualPackage1 = () => toInvoice({
  id: 'invoice-1',
  number: 'RRIT-2026-000123',
  kind: 'invoice',
  credited_invoice_id: null,
  status: 'paid',
  issued_at: new Date('2026-09-18T10:00:00Z'),
  currency: 'EUR',
  seller: { name: 'Rrit', address: 'Prishtinë', fiscalNumber: '' },
  buyer: { name: 'Hamza Rent a Car', address: 'Rr. Dëshmorët', city: 'Rahovec', country: 'Kosovë', fiscalNumber: '811234567' },
  lines: [{ description: 'Pako 1 · annual subscription (12 months)', quantity: 1, unitPriceCents: 25490, totalCents: 25490 }],
  subtotal_cents: 25490,
  vat_rate_basis_points: 0,
  vat_cents: 0,
  total_cents: 25490,
})

describe('invoice PDF', () => {
  it('states the recorded payment instead of the stored status', async () => {
    const invoice = annualPackage1()
    const unpaid = invoicePdf(invoice, { status: 'unpaid', dueAt: '2026-10-28T10:00:00Z', paidAt: null }).toString('latin1')
    expect(unpaid).toContain('Status: Unpaid - due by 28.10.2026')
    const paid = invoicePdf(invoice, { status: 'paid', dueAt: '2026-10-28T10:00:00Z', paidAt: '2026-10-20T10:00:00Z' })
    expect(paid.toString('latin1')).toContain('Status: Paid \\(20.10.2026\\)')
    if (process.env.INVOICE_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.INVOICE_PDF_OUT, paid)
  })

  it('contains the number, date, items and amount', async () => {
    const invoice = annualPackage1()
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
