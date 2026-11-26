import { describe, expect, it } from 'vitest'
import { invoiceFixture, supplierFixture } from '@/test/fixtures'
import {
  billingToForm,
  emptyInvoiceForm,
  invoiceToForm,
  paymentFormFor,
  toBillingProfile,
  toInvoiceInput,
  toPaymentInput,
  validateBillingForm,
  validateInvoiceForm,
  validatePaymentForm,
} from './invoiceForm'
import { blankLine, hasOrderErrors } from './salesForm'

const TODAY = '2026-11-26'

describe('invoice form', () => {
  const good = () => ({
    ...emptyInvoiceForm('net14'),
    customerId: 'c1',
    lines: [{ ...blankLine(1), description: 'CT meter', quantity: '2', unitPrice: '120000' }],
  })

  it('starts with the business defaults, and no VAT for a business that is not registered', () => {
    expect(emptyInvoiceForm('net7')).toMatchObject({ paymentTerms: 'net7', vatRate: '15' })
    expect(emptyInvoiceForm('net30', false).vatRate).toBe('0')
  })

  it('accepts a complete draft; a blank due date is set when issued', () => {
    expect(hasOrderErrors(validateInvoiceForm(good(), TODAY))).toBe(false)
    expect(toInvoiceInput(good())).toMatchObject({
      dueDate: null,
      paymentTerms: 'net14',
      items: [{ description: 'CT meter', quantity: 2, unitPrice: 120000 }],
    })
  })

  it('needs a customer and lines, and refuses a past due date', () => {
    const e = validateInvoiceForm(
      { ...good(), customerId: '', lines: [], dueDate: '2026-11-25' },
      TODAY,
    )
    expect(e.customerId).toBeTruthy()
    expect(e.lines).toBeTruthy()
    expect(e.dueDate).toMatch(/past/)
  })

  it('round-trips an invoice', () => {
    const form = invoiceToForm(invoiceFixture())
    expect(toInvoiceInput(form)).toMatchObject({
      customerId: 'c1',
      orderId: 'o1',
      discountPercent: 5,
      vatRate: 15,
    })
  })
})

describe('payment form', () => {
  const limits = { balance: 130000, issueDate: '2026-11-01' }
  it('defaults to the full balance today', () => {
    expect(paymentFormFor(130000.5).amount).toBe('130000.50')
  })

  it('refuses more than the balance, zero, the future and before issue', () => {
    const v = paymentFormFor(1)
    expect(validatePaymentForm({ ...v, amount: '130000.01' }, limits, TODAY).amount).toMatch(
      /more than/,
    )
    expect(validatePaymentForm({ ...v, amount: '0' }, limits, TODAY).amount).toBeTruthy()
    expect(validatePaymentForm({ ...v, amount: '1,000' }, limits, TODAY).amount).toBeTruthy()
    expect(validatePaymentForm({ ...v, paidOn: '2026-11-27' }, limits, TODAY).paidOn).toMatch(
      /future/,
    )
    expect(validatePaymentForm({ ...v, paidOn: '2026-10-31' }, limits, TODAY).paidOn).toMatch(
      /before/,
    )
    expect(validatePaymentForm({ ...v, amount: '130000', paidOn: TODAY }, limits, TODAY)).toEqual(
      {},
    )
  })

  it('converts for saving', () => {
    expect(
      toPaymentInput('inv1', { ...paymentFormFor(1), amount: '99.9', reference: ' FNB-1 ' }),
    ).toMatchObject({ invoiceId: 'inv1', amount: 99.9, reference: 'FNB-1', notes: null })
  })
})

describe('billing form', () => {
  it('needs a valid VAT number only when VAT registered', () => {
    const form = billingToForm(supplierFixture())
    expect(validateBillingForm(form)).toEqual({})
    expect(validateBillingForm({ ...form, vatNumber: '1234567890' }).vatNumber).toBeTruthy()
    expect(validateBillingForm({ ...form, vatRegistered: false, vatNumber: '' })).toEqual({})
  })

  it('checks bank details and keeps digits only', () => {
    const form = billingToForm(supplierFixture())
    expect(validateBillingForm({ ...form, bankBranchCode: '25065' }).bankBranchCode).toBeTruthy()
    expect(
      toBillingProfile({ ...form, bankAccountNumber: '6284 9102 488', vatNumber: '418 029 4512' }),
    ).toMatchObject({ bankAccountNumber: '62849102488', vatNumber: '4180294512' })
  })
})
