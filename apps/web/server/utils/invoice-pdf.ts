import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Invoice } from './invoices'

// A dependency-free single-page PDF using the standard Helvetica fonts with
// WinAnsi encoding, which covers Albanian (ë, ç) and the euro sign.

// --- Logo (SVG paths → PDF vector graphics) ---------------------------------

function r(n: number) { return String(Math.round(n * 100) / 100) }

// Converts SVG path data (M/m/L/l/H/h/V/v/C/c/Z/z) to PDF path operators.
// All PDF operators use absolute coordinates; Y is flipped (SVG↓ → PDF↑).
function svgToPdf(d: string, xOff: number, yBase: number, s: number): string {
  const T = (x: number, y: number) => `${r(xOff + x * s)} ${r(yBase - y * s)}`
  const tok = d.match(/[MmLlHhVvCcZz]|[-+]?(?:\d*\.?\d+)/g) ?? []
  let i = 0, cx = 0, cy = 0
  const out: string[] = []
  const n = () => parseFloat(tok[i++]!)
  while (i < tok.length) {
    const cmd = tok[i++]!
    switch (cmd) {
      case 'M': cx = n(); cy = n(); out.push(`${T(cx, cy)} m`); break
      case 'm': cx += n(); cy += n(); out.push(`${T(cx, cy)} m`); break
      case 'L': cx = n(); cy = n(); out.push(`${T(cx, cy)} l`); break
      case 'l': { const dx = n(), dy = n(); cx += dx; cy += dy; out.push(`${T(cx, cy)} l`); break }
      case 'H': cx = n(); out.push(`${T(cx, cy)} l`); break
      case 'h': cx += n(); out.push(`${T(cx, cy)} l`); break
      case 'V': cy = n(); out.push(`${T(cx, cy)} l`); break
      case 'v': cy += n(); out.push(`${T(cx, cy)} l`); break
      case 'C': {
        const x1=n(),y1=n(),x2=n(),y2=n(),x=n(),y=n()
        out.push(`${T(x1,y1)} ${T(x2,y2)} ${T(x,y)} c`)
        cx=x; cy=y; break
      }
      case 'c': {
        const dx1=n(),dy1=n(),dx2=n(),dy2=n(),dx=n(),dy=n()
        out.push(`${T(cx+dx1,cy+dy1)} ${T(cx+dx2,cy+dy2)} ${T(cx+dx,cy+dy)} c`)
        cx+=dx; cy+=dy; break
      }
      case 'Z': case 'z': out.push('h'); break
    }
  }
  return out.join('\n')
}

// Framic F logo helpers.
function logoPdfAsset() {
  const candidates = [
    resolve(process.cwd(), 'public/f-logo-pdf.jpg'),
    resolve(process.cwd(), '.output/public/f-logo-pdf.jpg'),
    resolve(process.cwd(), 'apps/web/public/f-logo-pdf.jpg'),
  ]
  const path = candidates.find(candidate => existsSync(candidate))
  if (!path) throw new Error('Framic invoice logo asset is missing')
  return readFileSync(path)
}

function logoImagePdfOps(pageWidth = 595, topMargin = 45, logoWidth = 110, left?: number): string {
  const logoHeight = logoWidth * (1240 / 1268)
  const x = left ?? pageWidth - topMargin - logoWidth
  const y = 842 - topMargin - logoHeight
  return `q\n${r(logoWidth)} 0 0 ${r(logoHeight)} ${r(x)} ${r(y)} cm\n/Im1 Do\nQ`
}

// Used by the monthly report PDF, whose page builder does not include image
// XObjects. Invoice PDFs use the exact image above.
export function logoPdfOps(pageWidth = 595, topMargin = 45, logoWidth = 110, left?: number): string {
  const s = logoWidth / 102
  const xOff = left ?? pageWidth - topMargin - logoWidth
  const yBase = 842 - topMargin
  const paths = [
    'M4 37V20C4 10 10 4 20 4h32v7H20c-5 0-8 3-8 9v17Z',
    'M12 22h32v7H12Z',
  ]
  const allPaths = paths.map(d => svgToPdf(d, xOff, yBase, s)).join('\n')
  return `0.09 0.41 0.30 rg\n${allPaths}\nf`
}
const winAnsiExtras: Record<string, number> = { '€': 0x80, '–': 0x96, '—': 0x97, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85 }

export function pdfText(value: string) {
  let out = ''
  for (const char of value.normalize('NFC')) {
    const code = winAnsiExtras[char] ?? char.codePointAt(0)!
    const byte = code <= 0xff && !(code >= 0x80 && code <= 0x9f && !(char in winAnsiExtras)) ? code : 0x3f
    const ch = String.fromCharCode(byte)
    out += ch === '(' || ch === ')' || ch === '\\' ? `\\${ch}` : ch
  }
  return out
}

// Invoices use the stored currency; the legacy PDF formatter is EUR based.
export function formatInvoiceMoney(value: number, currency: string = 'EUR', decimals = 2) {
  const sign = value < 0 ? '-' : ''
  const [whole, cents] = Math.abs(value).toFixed(decimals).split('.')
  const symbol = currency === 'CHF' ? 'CHF ' : '€'
  return `${sign}${symbol}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}
// Kosovo local date and time of the purchase, to the second: an invoice
// issued just after midnight must not show the previous day.
function formatDate(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZone: 'Europe/Belgrade',
  }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`
}
function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** The payment state recorded beside the invoice; the invoice row never changes. */
export type InvoicePaymentState = { status: 'paid' | 'unpaid'; dueAt: string; paidAt: string | null }

export function invoicePdf(invoice: Invoice, payment?: InvoicePaymentState | null) {
  const ops: string[] = []
  // Text in current fill color
  const text = (x: number, y: number, value: string, size = 10, bold = false) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`)
  // Stroke lines in current stroke color
  const hline = (x1: number, x2: number, y: number, w = 0.5) =>
    ops.push(`${w} w ${x1} ${y} m ${x2} ${y} l S`)
  // Filled rectangle
  const rect = (x: number, y: number, w: number, h: number) =>
    ops.push(`${x} ${y} ${w} ${h} re f`)

  // --- Logo (green) ---
  // Sized to sit beside the title and end above the divider at y=742.
  ops.push(logoImagePdfOps(595, 45, 44))

  // --- Reset to black for all remaining content ---
  ops.push('0 0 0 rg 0 0 0 RG')

  // --- Document title (left, alongside logo) ---
  const isCredit = invoice.kind === 'credit_note'
  text(50, 765, isCredit ? 'Credit note' : 'Invoice', 22, true)

  // --- Green divider below logo + title ---
  ops.push('0.09 0.41 0.30 RG')
  hline(50, 545, 742, 1.5)
  ops.push('0 0 0 RG')

  // --- Invoice meta ---
  text(50, 726, `No. ${invoice.number}`, 10, true)
  text(50, 711, `Date & time: ${formatDate(invoice.issuedAt)}`)
  // The stored invoice status predates payment tracking and always reads
  // "paid"; the recorded payment is what the document must state.
  const statusLabel = !payment
    ? (invoice.status === 'paid' ? 'Paid' : invoice.status)
    : payment.status === 'paid'
      ? `Paid${payment.paidAt ? ` (${formatDate(payment.paidAt).split(' ')[0]})` : ''}`
      : `Unpaid - due by ${formatDate(payment.dueAt).split(' ')[0]}`
  text(50, 696, `Status: ${statusLabel}`)

  // --- Section divider ---
  hline(50, 545, 684)

  // --- Parties ---
  const party = (x: number, label: string, value: Invoice['seller']) => {
    let y = 666
    text(x, y, label, 8, true)
    ops.push('0.4 0.4 0.4 rg')
    for (const line of [
      value.name,
      value.address,
      [value.city, value.country].filter(Boolean).join(', '),
      value.fiscalNumber ? `Fiscal no.: ${value.fiscalNumber}` : '',
    ].filter(Boolean)) {
      y -= 14
      text(x, y, truncate(line!, 46), 9)
    }
    ops.push('0 0 0 rg')
  }
  party(50, 'SELLER', invoice.seller)
  party(310, 'CUSTOMER', invoice.buyer)

  // --- Table header ---
  let y = 580
  ops.push('0.09 0.41 0.30 rg')
  rect(50, y - 4, 495, 18)
  ops.push('1 1 1 rg')
  text(55, y + 1, 'Description', 8, true)
  text(340, y + 1, 'Qty', 8, true)
  text(395, y + 1, 'Unit price', 8, true)
  text(490, y + 1, 'Amount', 8, true)
  ops.push('0 0 0 rg')

  // --- Table rows ---
  y -= 6
  for (const line of invoice.lines) {
    y -= 20
    // Legacy package invoices stored quantity=1 while the description held
    // the actual package count. Keep those immutable invoices readable too.
    const countMatch = line.description.match(/(\d+)\s+(?:videos?|posts?|credits?)/i)
    const displayQuantity = countMatch ? Number(countMatch[1]) : line.quantity
    const displayUnitPrice = countMatch && displayQuantity > 0
      ? line.totalCents / displayQuantity
      : line.unitPriceCents
    const displayDescription = /\bcredits?\b/i.test(line.description)
      ? 'Credits'
      : /\bvideos?\b/i.test(line.description)
        ? 'Video'
        : /\bposts?\b/i.test(line.description)
          ? 'Posts'
          : line.description
    text(55, y, truncate(displayDescription, 52), 9)
    text(340, y, String(displayQuantity), 9)
    const unitDecimals = /\bcredits?\b/i.test(line.description) ? 4 : 2
    text(395, y, formatInvoiceMoney(displayUnitPrice / 100, invoice.currency, unitDecimals), 9)
    text(490, y, formatInvoiceMoney(line.totalCents / 100, invoice.currency), 9)
    ops.push('0.85 0.85 0.85 RG')
    hline(50, 545, y - 6, 0.3)
    ops.push('0 0 0 RG')
  }

  // --- Totals box ---
  y -= 20
  hline(310, 545, y + 14, 0.5)

  ops.push('0.97 0.97 0.97 rg')
  rect(310, y - 54, 235, 66)
  ops.push('0 0 0 rg')

  y -= 4
  text(315, y, 'Subtotal', 9)
  text(490, y, formatInvoiceMoney(invoice.subtotal, invoice.currency), 9)
  y -= 16
  text(315, y, `VAT (${invoice.vatRate.toLocaleString('en-US')}%)`, 9)
  text(490, y, formatInvoiceMoney(invoice.vat, invoice.currency), 9)
  y -= 20
  text(315, y, 'Total', 11, true)
  text(490, y, formatInvoiceMoney(invoice.total, invoice.currency), 11, true)

  // --- Footer ---
  ops.push('0.09 0.41 0.30 RG')
  hline(50, 545, 75, 0.5)
  ops.push('0 0 0 RG')
  ops.push('0.5 0.5 0.5 rg')
  text(50, 60, 'Prices are net; VAT is added where applicable.', 7.5)
  ops.push('0 0 0 rg')

  const stream = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    (() => {
      const image = logoPdfAsset()
      return `<< /Type /XObject /Subtype /Image /Width 1268 /Height 1240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n${image.toString('latin1')}\nendstream`
    })(),
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
