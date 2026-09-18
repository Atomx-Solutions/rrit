import type { Invoice } from './invoices'

// A dependency-free single-page PDF using the standard Helvetica fonts with
// WinAnsi encoding, which covers Albanian (ë, ç) and the euro sign.
const winAnsiExtras: Record<string, number> = { '€': 0x80, '–': 0x96, '—': 0x97, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85 }

function pdfText(value: string) {
  let out = ''
  for (const char of value.normalize('NFC')) {
    const code = winAnsiExtras[char] ?? char.codePointAt(0)!
    const byte = code <= 0xff && !(code >= 0x80 && code <= 0x9f && !(char in winAnsiExtras)) ? code : 0x3f
    const ch = String.fromCharCode(byte)
    out += ch === '(' || ch === ')' || ch === '\\' ? `\\${ch}` : ch
  }
  return out
}

export function formatInvoiceMoney(value: number) {
  const sign = value < 0 ? '-' : ''
  const [whole, cents] = Math.abs(value).toFixed(2).split('.')
  return `${sign}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents} €`
}
function formatDate(iso: string) {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
}
function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function invoicePdf(invoice: Invoice) {
  const ops: string[] = []
  const text = (x: number, y: number, value: string, size = 10, bold = false) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`)
  const rule = (y: number) => ops.push(`0.8 w 50 ${y} m 545 ${y} l S`)

  const title = invoice.kind === 'credit_note' ? 'Faturë kreditore / Credit note' : 'Faturë / Invoice'
  text(50, 780, title, 18, true)
  text(50, 758, `Nr. ${invoice.number}`, 11, true)
  text(50, 742, `Data / Date: ${formatDate(invoice.issuedAt)}`)
  text(330, 758, `Statusi / Status: ${invoice.status === 'paid' ? 'E paguar / Paid' : invoice.status}`)

  const party = (x: number, label: string, value: Invoice['seller']) => {
    let y = 700
    text(x, y, label, 9, true)
    for (const line of [
      value.name,
      value.address,
      [value.city, value.country].filter(Boolean).join(', '),
      value.fiscalNumber ? `Nr. fiskal / Tax no.: ${value.fiscalNumber}` : '',
    ].filter(Boolean)) {
      y -= 14
      text(x, y, truncate(line!, 48))
    }
  }
  party(50, 'Shitësi / Seller', invoice.seller)
  party(330, 'Blerësi / Customer', invoice.buyer)

  let y = 610
  text(50, y, 'Përshkrimi / Description', 9, true)
  text(340, y, 'Sasia / Qty', 9, true)
  text(410, y, 'Çmimi / Price', 9, true)
  text(490, y, 'Totali / Total', 9, true)
  rule(y - 6)
  for (const line of invoice.lines) {
    y -= 22
    text(50, y, truncate(line.description, 52))
    text(340, y, String(line.quantity))
    text(410, y, formatInvoiceMoney(line.unitPriceCents / 100))
    text(490, y, formatInvoiceMoney(line.totalCents / 100))
  }
  rule(y - 10)
  y -= 30
  text(340, y, 'Nëntotali / Subtotal')
  text(490, y, formatInvoiceMoney(invoice.subtotal))
  y -= 16
  text(340, y, `TVSH / VAT (${invoice.vatRate.toLocaleString('sq-AL')}%)`)
  text(490, y, formatInvoiceMoney(invoice.vat))
  y -= 20
  text(340, y, 'Totali / Total', 12, true)
  text(490, y, formatInvoiceMoney(invoice.total), 12, true)
  text(50, 60, 'Çmimet përfshijnë TVSH-në nëse aplikohet. / Prices include VAT where applicable.', 8)

  const stream = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
