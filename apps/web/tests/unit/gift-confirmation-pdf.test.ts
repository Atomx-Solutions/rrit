import { describe, expect, it } from 'vitest'
import { invoicePdf } from '../../server/utils/invoice-pdf'

const document = {
  id: 'gift', number: '', kind: 'invoice' as const, creditedInvoiceId: null, status: 'gift',
  issuedAt: '2026-11-19T12:45:43.000Z', currency: 'CHF',
  seller: { name: 'Framic', address: 'Street 1', fiscalNumber: '' },
  buyer: { name: 'Kafe Aroma Test', address: '', fiscalNumber: '' },
  lines: [{ description: 'HI — +100 credits', quantity: 1, unitPriceCents: 200, totalCents: 200 }],
  subtotal: 2, vatRate: 0, vat: 0, total: 2,
}

describe('gift confirmation PDF', () => {
  it('looks like an invoice whose status is Gift and whose total is zero', () => {
    const bytes = invoicePdf(document, null, { reference: 'FRAMIC-2026-000032', reason: 'Loyal Client' })
    const pdf = bytes.toString('latin1')
    expect(pdf).toContain('(Invoice)')
    expect(pdf).toContain('(No. FRAMIC-2026-000032)')
    expect(pdf).toContain('(Status: Gift - Loyal Client)')
    expect(pdf).toContain('(-CHF 2.00)')
    expect(pdf).toContain('(CHF 0.00)')
  })
})
