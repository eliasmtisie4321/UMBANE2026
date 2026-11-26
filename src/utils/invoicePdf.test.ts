// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { invoiceFixture, supplierFixture } from '@/test/fixtures'
import { buildInvoicePdf, invoiceTitle, pdfSafe } from './invoicePdf'

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

describe('invoice PDF', () => {
  it('builds a one-page PDF for a normal invoice', async () => {
    const bytes = await buildInvoicePdf({
      invoice: invoiceFixture(),
      payments: [],
      supplier: supplierFixture(),
    })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(await pageCount(bytes)).toBe(1)
  })

  it('continues onto further pages when there are many lines', async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({
      id: `i${i}`,
      productId: null,
      description: `Line ${i} with a long description that wraps onto a second line in the table`,
      quantity: 1,
      unitPrice: 10,
    }))
    const bytes = await buildInvoicePdf({
      invoice: invoiceFixture({ items }),
      payments: [],
      supplier: supplierFixture(),
    })
    expect(await pageCount(bytes)).toBeGreaterThan(1)
  })

  it('does not fail on characters the standard fonts cannot draw', async () => {
    const bytes = await buildInvoicePdf({
      invoice: invoiceFixture({
        notes: 'Merci beaucoup — ✓ done 😀 ŻÓŁW',
        billTo: { ...invoiceFixture().billTo, name: 'Ngũgĩ wa Thiong’o' },
      }),
      payments: [],
      supplier: supplierFixture({ name: 'Umbane ⚡ Energy' }),
    })
    expect(await pageCount(bytes)).toBe(1)
  })

  it('replaces only what cannot be drawn', () => {
    expect(pdfSafe('Café – “R 1 000” €')).toBe('Café – “R 1 000” €')
    expect(pdfSafe('⚡ ✓')).toBe('? ?')
  })

  it('is a tax invoice only when the supplier is VAT registered and VAT is charged', () => {
    expect(invoiceTitle(invoiceFixture(), supplierFixture())).toBe('TAX INVOICE')
    expect(invoiceTitle(invoiceFixture({ vatRate: 0 }), supplierFixture())).toBe('INVOICE')
    expect(invoiceTitle(invoiceFixture(), supplierFixture({ vatRegistered: false }))).toBe(
      'INVOICE',
    )
  })
})
