import { formatNumber } from './format'
import { pdfSafe } from './invoicePdf'

/** A report as the PDF shows it: headline figures and tables, already formatted as text. */
export interface ReportDocument {
  title: string
  business: string
  period: string
  /** e.g. "Generated 26 Nov 2026, 10:05 by Mia Manager". */
  generated: string
  /** Filters in effect, e.g. "Segment: Commercial". */
  filters?: string[]
  sections: ReportSection[]
}

export type ReportSection =
  | {
      kind: 'figures'
      heading: string
      items: Array<{ label: string; value: string; detail?: string }>
    }
  | {
      kind: 'table'
      heading: string
      columns: Array<{ label: string; align?: 'right'; weight?: number }>
      rows: string[][]
      note?: string
    }

/** At most this many table rows go in a PDF; the CSV always has them all. */
export const PDF_ROW_LIMIT = 2000

/**
 * Builds a landscape A4 report with pdf-lib (loaded only when someone exports). Tables repeat their
 * header on each new page; text too long for its column is shortened with "...".
 */
export async function buildReportPdf(report: ReportDocument): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(`${report.title} ${report.period}`))
  doc.setProducer('Umbane CRM')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.11, 0.13)
  const muted = rgb(0.26, 0.28, 0.32)
  const brand = rgb(0.09, 0.31, 0.65)
  const rule = rgb(0.84, 0.86, 0.92)
  const band = rgb(0.95, 0.96, 0.99)

  const W = 841.89
  const H = 595.28
  const M = 40
  const BOTTOM = M + 24
  let page = doc.addPage([W, H])
  let y = H - M

  type Font = typeof font
  const width = (t: string, size: number, f: Font = font) => f.widthOfTextAtSize(pdfSafe(t), size)
  const draw = (t: string, x: number, size = 9, f: Font = font, color = ink) =>
    page.drawText(pdfSafe(t), { x, y, size, font: f, color })
  const fit = (t: string, max: number, size: number, f: Font = font) => {
    if (width(t, size, f) <= max) return t
    let n = t.length
    while (n > 0 && width(`${t.slice(0, n)}...`, size, f) > max) n--
    return `${t.slice(0, n)}...`
  }
  const newPage = () => {
    page = doc.addPage([W, H])
    y = H - M
  }
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage()
  }

  // Title block
  draw(report.business, M, 10, bold, brand)
  y -= 22
  draw(report.title, M, 18, bold)
  y -= 18
  draw(report.period, M, 11, font, muted)
  y -= 14
  if (report.filters?.length) {
    draw(fit(report.filters.join(' · '), W - 2 * M, 9), M, 9, font, muted)
    y -= 12
  }
  draw(report.generated, M, 8, font, muted)
  y -= 22

  for (const s of report.sections) {
    if (s.kind === 'figures') {
      const perRow = 4
      const colW = (W - 2 * M) / perRow
      ensure(20 + 44)
      draw(s.heading, M, 11, bold)
      y -= 18
      s.items.forEach((item, i) => {
        if (i % perRow === 0 && i > 0) y -= 44
        if (i % perRow === 0) ensure(44)
        const x = M + (i % perRow) * colW
        const top = y
        page.drawText(pdfSafe(fit(item.label, colW - 12, 8)), {
          x,
          y: top,
          size: 8,
          font,
          color: muted,
        })
        page.drawText(pdfSafe(fit(item.value, colW - 12, 14, bold)), {
          x,
          y: top - 16,
          size: 14,
          font: bold,
          color: ink,
        })
        if (item.detail) {
          page.drawText(pdfSafe(fit(item.detail, colW - 12, 8)), {
            x,
            y: top - 28,
            size: 8,
            font,
            color: muted,
          })
        }
      })
      y -= 44 + 12
      continue
    }

    // Table
    const rows = s.rows.slice(0, PDF_ROW_LIMIT)
    const total = s.columns.reduce((n, c) => n + (c.weight ?? 1), 0)
    const widths = s.columns.map((c) => ((c.weight ?? 1) / total) * (W - 2 * M))
    const rowH = 15
    const header = () => {
      page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: band })
      let x = M
      s.columns.forEach((c, i) => {
        const label = fit(c.label, widths[i] - 8, 8, bold)
        const tx = c.align === 'right' ? x + widths[i] - 4 - width(label, 8, bold) : x + 4
        draw(label, tx, 8, bold, muted)
        x += widths[i]
      })
      y -= rowH
    }
    ensure(20 + rowH * 3)
    draw(s.heading, M, 11, bold)
    y -= 16
    if (rows.length === 0) {
      draw('Nothing in this period.', M, 9, font, muted)
      y -= 20
      continue
    }
    header()
    for (const r of rows) {
      if (y - rowH < BOTTOM) {
        newPage()
        draw(`${s.heading} (continued)`, M, 9, bold, muted)
        y -= 16
        header()
      }
      let x = M
      r.forEach((value, i) => {
        const col = s.columns[i]
        const t = fit(value, widths[i] - 8, 8)
        const tx = col?.align === 'right' ? x + widths[i] - 4 - width(t, 8) : x + 4
        draw(t, tx, 8)
        x += widths[i]
      })
      page.drawLine({
        start: { x: M, y: y - 4 },
        end: { x: W - M, y: y - 4 },
        thickness: 0.5,
        color: rule,
      })
      y -= rowH
    }
    const notes = [
      s.note,
      s.rows.length > rows.length
        ? `The first ${formatNumber(rows.length)} of ${formatNumber(s.rows.length)} rows are shown; the CSV export has them all.`
        : undefined,
    ].filter(Boolean) as string[]
    for (const n of notes) {
      ensure(14)
      y -= 4
      draw(fit(n, W - 2 * M, 8), M, 8, font, muted)
      y -= 10
    }
    y -= 14
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => {
    p.drawText(pdfSafe(fit(`${report.title} · ${report.period}`, W / 2, 8)), {
      x: M,
      y: M - 8,
      size: 8,
      font,
      color: muted,
    })
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, { x: W - M - width(label, 8), y: M - 8, size: 8, font, color: muted })
  })
  return doc.save()
}
