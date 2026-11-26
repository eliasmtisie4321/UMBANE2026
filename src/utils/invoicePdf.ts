import type { BillingProfile, Invoice, Payment } from '@/types/invoices'
import { PAYMENT_TERMS } from '@/types/invoices'
import { formatDate } from './format'
import { formatPhone } from './phone'

/**
 * Builds the invoice as a PDF in the browser. pdf-lib is loaded only when someone downloads, so it
 * does not slow down the rest of the app. Standard PDF fonts cover Western European characters
 * only; anything else is replaced rather than failing the whole document.
 */

// Windows-1252 beyond Latin-1, which the standard fonts can draw.
const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export const pdfSafe = (text: string): string =>
  Array.from(text.normalize('NFC'))
    .map((ch) => {
      const code = ch.codePointAt(0)!
      if (ch === '\t') return ' '
      if (ch === '\n') return ch
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || EXTRA.has(ch))
        return ch
      return '?'
    })
    .join('')

const rand = (n: number) =>
  `R ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface PdfInput {
  invoice: Invoice
  payments: Payment[]
  supplier: BillingProfile
}

/** A tax invoice when the supplier is VAT registered and charged VAT; otherwise a plain invoice. */
export const invoiceTitle = (i: Invoice, s: BillingProfile) =>
  s.vatRegistered && i.vatRate > 0 ? 'TAX INVOICE' : 'INVOICE'

export async function buildInvoicePdf({ invoice: inv, payments, supplier: s }: PdfInput) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(`${inv.reference} ${s.name}`))
  doc.setProducer('Umbane CRM')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.11, 0.13)
  const muted = rgb(0.26, 0.28, 0.32)
  const brand = rgb(0.09, 0.31, 0.65)
  const line = rgb(0.84, 0.86, 0.92)

  const W = 595.28
  const H = 841.89
  const M = 48
  let page = doc.addPage([W, H])
  let y = H - M

  const width = (t: string, size: number, f = font) => f.widthOfTextAtSize(pdfSafe(t), size)
  const text = (t: string, x: number, size = 10, f = font, color = ink) =>
    page.drawText(pdfSafe(t), { x, y, size, font: f, color })
  const right = (t: string, x: number, size = 10, f = font, color = ink) =>
    text(t, x - width(t, size, f), size, f, color)
  /** Splits text into lines that fit `max` points. */
  const wrap = (t: string, max: number, size = 10): string[] => {
    const out: string[] = []
    for (const para of pdfSafe(t).split('\n')) {
      let cur = ''
      for (const word of para.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word
        if (width(next, size) <= max) cur = next
        else {
          if (cur) out.push(cur)
          // A single word wider than the column is cut, not allowed to run off the page.
          let w = word
          while (width(w, size) > max) {
            let n = w.length
            while (n > 1 && width(w.slice(0, n), size) > max) n--
            out.push(w.slice(0, n))
            w = w.slice(n)
          }
          cur = w
        }
      }
      out.push(cur)
    }
    return out
  }
  const ensure = (needed: number) => {
    if (y - needed < M + 40) {
      page = doc.addPage([W, H])
      y = H - M
    }
  }

  // Supplier and title
  text(s.name, M, 16, bold, brand)
  right(invoiceTitle(inv, s), W - M, 16, bold)
  y -= 18
  const supplierLines = [
    ...(s.address ? wrap(s.address, 260, 9) : []),
    [s.registrationNumber && `Reg: ${s.registrationNumber}`, s.vatNumber && `VAT: ${s.vatNumber}`]
      .filter(Boolean)
      .join(' · '),
    [s.email, s.phone && formatPhone(s.phone)].filter(Boolean).join(' · '),
  ].filter(Boolean) as string[]
  const meta: Array<[string, string]> = [
    ['Invoice number', inv.invoiceNumber ?? 'DRAFT'],
    ['Issue date', inv.issueDate ? formatDate(inv.issueDate) : '-'],
    ['Due date', inv.dueDate ? formatDate(inv.dueDate) : '-'],
    ['Terms', PAYMENT_TERMS.find((t) => t.value === inv.paymentTerms)?.label ?? '-'],
    ...(inv.orderReference ? [['Order', inv.orderReference] as [string, string]] : []),
  ]
  const top = y
  for (const l of supplierLines) {
    text(l, M, 9, font, muted)
    y -= 12
  }
  const leftEnd = y
  y = top
  for (const [k, v] of meta) {
    right(k, W - M - 110, 9, font, muted)
    right(v, W - M, 9, bold)
    y -= 12
  }
  y = Math.min(leftEnd, y) - 16

  // Bill to
  text('BILL TO', M, 9, bold, muted)
  if (inv.propertyName) text('SERVICE PROPERTY', 330, 9, bold, muted)
  y -= 13
  const billTo = [
    inv.billTo.companyName ?? inv.billTo.name,
    ...(inv.billTo.companyName ? [`Attn: ${inv.billTo.name}`] : []),
    ...inv.billTo.address,
    ...(inv.billTo.registrationNumber ? [`Reg: ${inv.billTo.registrationNumber}`] : []),
    [inv.billTo.email, inv.billTo.phone && formatPhone(inv.billTo.phone)]
      .filter(Boolean)
      .join(' · '),
  ].filter(Boolean)
  const billTop = y
  billTo.forEach((l, i) => {
    text(l, M, 10, i === 0 ? bold : font)
    y -= 13
  })
  if (inv.propertyName) {
    const end = y
    y = billTop
    text(inv.propertyName, 330, 10)
    y = end
  }
  y -= 10

  // Lines
  const cols = { qty: 360, price: 450, amount: W - M }
  const header = () => {
    page.drawRectangle({
      x: M,
      y: y - 6,
      width: W - 2 * M,
      height: 20,
      color: rgb(0.95, 0.96, 0.99),
    })
    text('Description', M + 6, 9, bold, muted)
    right('Qty', cols.qty, 9, bold, muted)
    right('Unit price', cols.price, 9, bold, muted)
    right('Amount', cols.amount - 6, 9, bold, muted)
    y -= 22
  }
  header()
  for (const item of inv.items) {
    const rows = wrap(item.description, cols.qty - M - 60, 10)
    if (y - rows.length * 13 < M + 40) {
      ensure(Infinity)
      header()
    }
    const first = y
    rows.forEach((r) => {
      text(r, M + 6, 10)
      y -= 13
    })
    const end = y
    y = first
    right(item.quantity.toLocaleString('en-US'), cols.qty, 10)
    right(rand(item.unitPrice), cols.price, 10)
    right(rand(Math.round(item.quantity * item.unitPrice * 100) / 100), cols.amount - 6, 10)
    y = end - 4
    page.drawLine({
      start: { x: M, y: y + 2 },
      end: { x: W - M, y: y + 2 },
      thickness: 0.5,
      color: line,
    })
    y -= 8
  }

  // Totals
  ensure(110)
  const totals: Array<[string, string, boolean]> = [
    ['Subtotal', rand(inv.subtotal), false],
    ...(inv.discount > 0
      ? [
          [`Discount (${inv.discountPercent}%)`, `-${rand(inv.discount)}`, false] as [
            string,
            string,
            boolean,
          ],
        ]
      : []),
    [`VAT (${inv.vatRate}%)`, rand(inv.tax), false],
    ['Total', rand(inv.total), true],
    ...(inv.paid > 0
      ? ([
          ['Paid', `-${rand(inv.paid)}`, false],
          ['Balance due', rand(inv.balance), true],
        ] as Array<[string, string, boolean]>)
      : []),
  ]
  for (const [k, v, strong] of totals) {
    right(k, W - M - 120, strong ? 11 : 10, strong ? bold : font, strong ? ink : muted)
    right(v, W - M - 6, strong ? 11 : 10, strong ? bold : font)
    y -= strong ? 16 : 14
  }
  if (inv.status === 'cancelled') {
    y -= 4
    text(
      `CANCELLED${inv.cancelReason ? `: ${inv.cancelReason}` : ''}`,
      M,
      11,
      bold,
      rgb(0.73, 0.1, 0.1),
    )
    y -= 16
  }

  // Payments received
  if (payments.length > 0) {
    ensure(30 + payments.length * 13)
    y -= 8
    text('PAYMENTS RECEIVED', M, 9, bold, muted)
    y -= 14
    for (const p of payments) {
      ensure(14)
      text(
        `${formatDate(p.paidOn)}  ${p.referenceNumber}${p.reference ? `  (${p.reference})` : ''}`,
        M,
        9,
      )
      right(rand(p.amount), W - M - 6, 9)
      y -= 13
    }
  }

  // How to pay
  const bank = [
    s.bankName && `Bank: ${s.bankName}`,
    s.bankAccountName && `Account name: ${s.bankAccountName}`,
    s.bankAccountNumber && `Account number: ${s.bankAccountNumber}`,
    s.bankBranchCode && `Branch code: ${s.bankBranchCode}`,
    inv.invoiceNumber && `Payment reference: ${inv.invoiceNumber}`,
  ].filter(Boolean) as string[]
  const instructions = s.paymentInstructions ? wrap(s.paymentInstructions, W - 2 * M, 9) : []
  const notes = inv.notes ? wrap(inv.notes, W - 2 * M, 9) : []
  if (bank.length + instructions.length + notes.length > 0) {
    ensure(40 + (bank.length + instructions.length + notes.length) * 12)
    y -= 10
    if (bank.length || instructions.length) {
      text('PAYMENT DETAILS', M, 9, bold, muted)
      y -= 13
      for (const l of [...bank, ...instructions]) {
        text(l, M, 9)
        y -= 12
      }
    }
    if (notes.length) {
      y -= 6
      text('NOTES', M, 9, bold, muted)
      y -= 13
      for (const l of notes) {
        ensure(12)
        text(l, M, 9)
        y -= 12
      }
    }
  }

  // Footer and page numbers on every page
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    page = p
    y = M - 10
    if (s.invoiceFooter) text(wrap(s.invoiceFooter, W - 2 * M - 60, 8)[0], M, 8, font, muted)
    right(`Page ${i + 1} of ${pages.length}`, W - M, 8, font, muted)
  })
  return doc.save()
}

export async function downloadInvoicePdf(input: PdfInput) {
  const bytes = await buildInvoicePdf(input)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${input.invoice.invoiceNumber ?? 'draft-invoice'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
