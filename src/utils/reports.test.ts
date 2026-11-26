import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { fileSlug, toCsv } from './csv'
import { countShare, duration, filterNote, percent, pickOption, versus } from './reportFormat'
import { buildReportPdf } from './reportPdf'
import { presetRange, priorRange, rangeLabel, rangeProblem, readRange } from './reportRange'

describe('report periods', () => {
  const today = '2026-11-26'
  it('works out each preset from today', () => {
    expect(presetRange('this-month', today)).toEqual({ from: '2026-11-01', to: today })
    expect(presetRange('last-month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetRange('last-3-months', today)).toEqual({ from: '2026-09-01', to: today })
    expect(presetRange('last-12-months', today)).toEqual({ from: '2025-12-01', to: today })
    expect(presetRange('this-year', today)).toEqual({ from: '2026-01-01', to: today })
    expect(presetRange('last-year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    expect(presetRange('last-month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
    expect(presetRange('last-month', '2024-03-31')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    })
  })

  it('checks custom dates', () => {
    expect(rangeProblem('2026-01-01', '2026-02-01', today)).toBeNull()
    expect(rangeProblem('', '2026-02-01', today)).toBe('Enter a start and an end date.')
    expect(rangeProblem('2026-02-30', '2026-03-01', today)).toBe('Enter a start and an end date.')
    expect(rangeProblem('2026-03-01', '2026-02-01', today)).toMatch(/on or before/)
    expect(rangeProblem('2026-12-01', '2026-12-31', today)).toMatch(/future/)
    expect(rangeProblem('2020-01-01', '2026-01-01', today)).toMatch(/five years/)
  })

  it('reads the period from the address, falling back to the last 12 months', () => {
    const read = (q: string) => readRange(new URLSearchParams(q), today)
    expect(read('')).toMatchObject({ preset: 'last-12-months', problem: null })
    expect(read('range=last-month').range).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(read('range=nonsense').preset).toBe('last-12-months')
    expect(read('range=custom&from=2024-03-01&to=2024-03-31')).toEqual({
      preset: 'custom',
      range: { from: '2024-03-01', to: '2024-03-31' },
      problem: null,
      entered: { from: '2024-03-01', to: '2024-03-31' },
    })
    const bad = read('range=custom&from=2024-03-31&to=2024-03-01')
    expect(bad.problem).toMatch(/on or before/)
    expect(bad.range).toEqual({ from: '2025-12-01', to: today })
    expect(bad.entered).toEqual({ from: '2024-03-31', to: '2024-03-01' })
  })

  it('describes a period and the one before it', () => {
    expect(rangeLabel({ from: '2024-03-01', to: '2024-03-31' })).toBe('1 Mar 2024 – 31 Mar 2024')
    expect(rangeLabel({ from: '2024-03-01', to: '2024-03-01' })).toBe('1 Mar 2024')
    expect(priorRange({ from: '2024-03-01', to: '2024-03-31' })).toEqual({
      from: '2024-01-30',
      to: '2024-02-29',
    })
  })
})

describe('CSV', () => {
  const cols = [
    { label: 'Name', value: (r: { name: string; n: number | null }) => r.name },
    { label: 'Amount', value: (r: { name: string; n: number | null }) => r.n },
  ]
  it('quotes commas, quotes and line breaks, and writes numbers plainly', () => {
    const csv = toCsv(cols, [
      { name: 'Smith, J', n: 1250.5 },
      { name: 'Say "hi"', n: null },
      { name: 'Two\nlines', n: -3 },
    ])
    expect(csv).toBe('Name,Amount\r\n"Smith, J",1250.5\r\n"Say ""hi""",\r\n"Two\nlines",-3\r\n')
  })

  it('keeps text that looks like a formula as text', () => {
    const csv = toCsv(cols, [
      { name: '=HYPERLINK("http://x")', n: 1 },
      { name: '+27 82 000', n: 2 },
      { name: '@SUM(A1)', n: 3 },
      { name: '-1', n: 4 },
    ])
    expect(csv.split('\r\n').slice(1, 5)).toEqual([
      `"'=HYPERLINK(""http://x"")",1`,
      `'+27 82 000,2`,
      `'@SUM(A1),3`,
      `'-1,4`,
    ])
  })

  it('makes a safe file name', () => {
    expect(fileSlug('Sales and invoice report')).toBe('sales-and-invoice-report')
  })
})

describe('report wording', () => {
  it('compares with the previous period', () => {
    expect(versus(110, 100)).toBe('+10% on the previous period')
    expect(versus(90, 100)).toBe('-10% on the previous period')
    expect(versus(5, 0)).toBe('Nothing in the previous period')
    expect(versus(0, 0)).toBe('Same as the previous period')
  })

  it('formats shares, percentages and durations', () => {
    expect(countShare(318, 1248)).toBe('318 (25.5%)')
    expect(countShare(3, 0)).toBe('3')
    expect(percent(1, 3)).toBe('33.3%')
    expect(percent(1, 0)).toBe('-')
    expect(duration(null)).toBe('-')
    expect(duration(2)).toBe('2 hours')
    expect(duration(72)).toBe('3 days')
  })

  it('accepts only known filter values', () => {
    const list = [{ value: 'commercial', label: 'Commercial' }]
    expect(pickOption('commercial', list)).toBe('commercial')
    expect(pickOption('<script>', list)).toBe('')
    expect(pickOption('none', list)).toBe('')
    expect(pickOption('none', list, true)).toBe('none')
    expect(filterNote('Segment', 'none', list)).toEqual(['Segment: Not recorded'])
    expect(filterNote('Segment', '', list)).toEqual([])
  })
})

describe('report PDF', () => {
  it('builds a landscape document over several pages for a long table', async () => {
    const bytes = await buildReportPdf({
      title: 'Customer report',
      business: 'Umbane',
      period: '1 Mar 2024 – 31 Mar 2024',
      generated: 'Generated 26 Nov 2026',
      filters: ['Segment: Commercial'],
      sections: [
        {
          kind: 'figures',
          heading: 'Summary',
          items: [{ label: 'Customers', value: '1,248', detail: '84 new' }],
        },
        {
          kind: 'table',
          heading: 'Customers',
          columns: [
            { label: 'Name', weight: 2 },
            { label: 'Billed', align: 'right' },
          ],
          rows: Array.from({ length: 120 }, (_, i) => [
            `Customer ${i} with a very long name that will not fit in its column at all`,
            `R ${i}`,
          ]),
        },
        { kind: 'table', heading: 'Empty', columns: [{ label: 'A' }], rows: [] },
      ],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(2)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeGreaterThan(height)
    expect(doc.getTitle()).toContain('Customer report')
  })
})
