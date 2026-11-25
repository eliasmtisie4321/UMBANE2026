import { describe, expect, it } from 'vitest'
import { formatDateTime } from './format'
import { orderTotals, parseCents, parsePercent, parseQuantity } from './orderMath'
import { periodRange } from './period'
import {
  blankLine,
  emptyLeadForm,
  emptyOrderForm,
  hasOrderErrors,
  toLeadInput,
  toOrderInput,
  totalsOf,
  validateActivityForm,
  validateLeadForm,
  validateOrderForm,
  emptyActivityForm,
  type LeadFormValues,
  type OrderFormValues,
} from './salesForm'

describe('parsing', () => {
  it.each([
    ['0', 0n],
    ['1500.5', 150050n],
    [' 1 234.05 ', 123405n],
  ])('reads %j as cents', (text, cents) => expect(parseCents(text)).toBe(cents))

  it.each(['', '-1', '1,500', '1.005', 'abc', '1e3', '.5', '5.'])('refuses %j', (text) =>
    expect(parseCents(text)).toBeNull(),
  )

  it('accepts 0 to 100 percent and whole quantities only', () => {
    expect(parsePercent('33.33')).toBe(3333n)
    expect(parsePercent('100')).toBe(10000n)
    expect(parsePercent('100.01')).toBeNull()
    expect(parseQuantity('100000')).toBe(100000)
    for (const bad of ['0', '-1', '1.5', '100001', '']) expect(parseQuantity(bad)).toBeNull()
  })
})

// The same figures as the database test, so both implementations are held to the same answers.
describe('orderTotals', () => {
  it('takes the discount off before VAT', () => {
    expect(
      orderTotals(
        [
          { quantity: 2, unitCents: 12_000_000n },
          { quantity: 1, unitCents: 4_600_000n },
        ],
        500n,
        15,
      ),
    ).toEqual({ subtotal: 286000, discount: 14300, tax: 40755, total: 312455 })
  })

  it('rounds half a cent up, without floating-point drift', () => {
    expect(orderTotals([{ quantity: 3, unitCents: 35n }], 3333n, 15)).toEqual({
      subtotal: 1.05,
      discount: 0.35,
      tax: 0.11,
      total: 0.81,
    })
  })

  it('handles no VAT, a full discount, no lines and very large orders', () => {
    const line = [{ quantity: 4, unitCents: 2500n }]
    expect(orderTotals(line, 0n, 0)).toMatchObject({ tax: 0, total: 100 })
    expect(orderTotals(line, 10_000n, 15)).toMatchObject({ discount: 100, tax: 0, total: 0 })
    expect(orderTotals([], 0n, 15).total).toBe(0)
    expect(orderTotals([{ quantity: 100_000, unitCents: 999_999_999n }], 0n, 0).total).toBe(
      999_999_999_000,
    )
  })
})

describe('lead form', () => {
  const good: LeadFormValues = {
    ...emptyLeadForm,
    name: ' Gavin Petersen ',
    email: ' Gavin@Melrose.test ',
    phone: '011 684 2200',
    source: 'referral',
    estimatedValue: '540 000',
  }

  it('accepts a complete lead and normalises it for saving', () => {
    expect(validateLeadForm(good)).toEqual({})
    expect(toLeadInput(good)).toMatchObject({
      name: 'Gavin Petersen',
      email: 'gavin@melrose.test',
      phone: '+27116842200',
      estimatedValue: 540000,
      companyName: null,
      stage: 'new',
    })
  })

  it('needs a name, a source and some way to reach the person', () => {
    expect(Object.keys(validateLeadForm(emptyLeadForm)).sort()).toEqual(['name', 'phone', 'source'])
    expect(validateLeadForm({ ...good, phone: '' })).toEqual({})
    expect(validateLeadForm({ ...good, email: '' })).toEqual({})
  })

  it('checks the email, value and dates', () => {
    const e = validateLeadForm({
      ...good,
      email: 'nope',
      estimatedValue: '1,000',
      followUpOn: '2026-02-30',
    })
    expect(Object.keys(e).sort()).toEqual(['email', 'estimatedValue', 'followUpOn'])
  })

  it('leaves the stage alone for a closed lead, and a blank value unknown rather than zero', () => {
    expect(toLeadInput(good, true).stage).toBeNull()
    expect(toLeadInput({ ...good, estimatedValue: '' }).estimatedValue).toBeNull()
  })
})

describe('order form', () => {
  const good = (): OrderFormValues => ({
    ...emptyOrderForm(),
    customerId: 'c1',
    orderDate: '2026-11-25',
    discountPercent: '5',
    lines: [{ ...blankLine(1), description: ' CT meter ', quantity: '2', unitPrice: '120000' }],
  })
  const check = (over: Partial<OrderFormValues>) =>
    validateOrderForm({ ...good(), ...over }, '2026-11-25')

  it('accepts a complete order dated today', () => {
    expect(hasOrderErrors(check({}))).toBe(false)
    expect(toOrderInput(good())).toMatchObject({
      discountPercent: 5,
      vatRate: 15,
      propertyId: null,
      items: [{ description: 'CT meter', quantity: 2, unitPrice: 120000, productId: null }],
    })
  })

  it('refuses no customer, a future date, no lines, and a bad discount', () => {
    expect(check({ customerId: '' }).customerId).toBeTruthy()
    expect(check({ orderDate: '2026-11-26' }).orderDate).toMatch(/future/)
    expect(check({ lines: [] }).lines).toBeTruthy()
    expect(check({ discountPercent: '101' }).discountPercent).toBeTruthy()
    // An empty discount means none.
    expect(hasOrderErrors(check({ discountPercent: '' }))).toBe(false)
  })

  it('reports each problem on its own line', () => {
    const e = check({
      lines: [
        { ...blankLine(1), description: 'Good line', quantity: '1', unitPrice: '1' },
        { ...blankLine(7), description: '', quantity: '1.5', unitPrice: '-1' },
      ],
    })
    expect(e.line[1]).toBeUndefined()
    expect(Object.keys(e.line[7]).sort()).toEqual(['description', 'quantity', 'unitPrice'])
    expect(hasOrderErrors(e)).toBe(true)
  })

  it('refuses a total the database could not store', () => {
    const line = { description: 'Huge', quantity: '100000', unitPrice: '9999999.99' }
    expect(check({ lines: [{ ...blankLine(1), ...line }] }).lines).toMatch(/too large/)
  })

  it('counts only complete lines while typing', () => {
    const v = good()
    v.lines.push({ ...blankLine(2), description: 'Half typed', unitPrice: '12.' })
    expect(totalsOf(v).subtotal).toBe(240000)
  })
})

describe('activity form', () => {
  it('needs a subject', () => {
    expect(validateActivityForm(emptyActivityForm).subject).toBeTruthy()
    expect(validateActivityForm({ ...emptyActivityForm, subject: 'Call back' })).toEqual({})
  })
})

describe('dates', () => {
  it('turns periods into whole months, across year ends', () => {
    expect(periodRange('this-month', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(periodRange('last-month', '2026-01-31')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
    expect(periodRange('this-year', '2026-06-01')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange('', '2026-06-01')).toEqual({ from: '', to: '' })
  })

  it('shows times in South Africa, including past midnight', () => {
    expect(formatDateTime('2026-11-22T08:05:00Z')).toBe('22 Nov 2026, 10:05')
    expect(formatDateTime('2026-11-22T22:30:00Z')).toBe('23 Nov 2026, 00:30')
  })
})
