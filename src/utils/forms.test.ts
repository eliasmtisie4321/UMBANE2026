import { describe, expect, it } from 'vitest'
import type { Customer } from '@/types/customers'
import {
  changedFieldLabels,
  customerToForm,
  emptyCustomerForm,
  toCustomerInput,
  validateCustomerForm,
  type CustomerFormValues,
} from './customerForm'
import {
  emptyPropertyForm,
  propertyToForm,
  toPropertyInput,
  validatePropertyForm,
  type PropertyFormValues,
} from './propertyForm'

const customer = (over: Partial<CustomerFormValues> = {}): CustomerFormValues => ({
  ...emptyCustomerForm,
  name: 'Thabo Mokoena',
  phone: '082 441 9082',
  ...over,
})

describe('validateCustomerForm', () => {
  it('accepts a minimal valid customer', () => {
    expect(validateCustomerForm(customer())).toEqual({})
  })
  it('requires a name', () => {
    expect(validateCustomerForm(customer({ name: ' ' })).name).toBeDefined()
    expect(validateCustomerForm(customer({ name: 'A' })).name).toBeDefined()
  })
  it('requires some way to contact the customer', () => {
    expect(validateCustomerForm(customer({ phone: '', email: '' })).phone).toMatch(
      /phone number or an email/,
    )
    expect(validateCustomerForm(customer({ phone: '', email: 'a@b.co' }))).toEqual({})
  })
  it('validates email and phone formats', () => {
    expect(validateCustomerForm(customer({ email: 'nope' })).email).toBeDefined()
    expect(validateCustomerForm(customer({ phone: '123' })).phone).toBeDefined()
    expect(validateCustomerForm(customer({ altPhone: 'abc' })).altPhone).toBeDefined()
  })
  it('validates the SA ID number when given', () => {
    expect(validateCustomerForm(customer({ idNumber: '8805145028084' })).idNumber).toBeUndefined()
    expect(validateCustomerForm(customer({ idNumber: '880514 502 8084' })).idNumber).toBeUndefined()
    expect(validateCustomerForm(customer({ idNumber: '8805145028085' })).idNumber).toBeDefined()
  })
  it('requires a company name for business customers only', () => {
    expect(validateCustomerForm(customer({ customerType: 'business' })).companyName).toBeDefined()
    expect(
      validateCustomerForm(customer({ customerType: 'business', companyName: 'Kagiso (Pty) Ltd' })),
    ).toEqual({})
    expect(
      validateCustomerForm(customer({ customerType: 'individual' })).companyName,
    ).toBeUndefined()
  })
  it('checks the registration number format', () => {
    const base = { customerType: 'business' as const, companyName: 'X (Pty) Ltd' }
    expect(
      validateCustomerForm(customer({ ...base, registrationNumber: '2019/482190/07' })),
    ).toEqual({})
    expect(
      validateCustomerForm(customer({ ...base, registrationNumber: '12345' })).registrationNumber,
    ).toBeDefined()
  })
  it('checks postal code, province and notes length', () => {
    expect(validateCustomerForm(customer({ postalCode: '21' })).postalCode).toBeDefined()
    expect(validateCustomerForm(customer({ postalCode: '2196', province: 'Gauteng' }))).toEqual({})
    expect(validateCustomerForm(customer({ province: 'Narnia' })).province).toBeDefined()
    expect(validateCustomerForm(customer({ notes: 'x'.repeat(2001) })).notes).toBeDefined()
  })
})

describe('toCustomerInput', () => {
  it('normalises, trims and turns blanks into null', () => {
    const input = toCustomerInput(
      customer({
        name: '  Thabo Mokoena ',
        email: ' THABO@Example.CO.ZA ',
        altPhone: '',
        idNumber: '880514 502 8084',
        city: ' ',
      }),
    )
    expect(input.name).toBe('Thabo Mokoena')
    expect(input.email).toBe('thabo@example.co.za')
    expect(input.phone).toBe('+27824419082')
    expect(input.altPhone).toBeNull()
    expect(input.idNumber).toBe('8805145028084')
    expect(input.city).toBeNull()
    expect(input.segment).toBeNull()
  })
  it('drops company details typed for a business that is now an individual', () => {
    const input = toCustomerInput(
      customer({
        customerType: 'individual',
        companyName: 'Leftover',
        registrationNumber: '2019/482190/07',
      }),
    )
    expect(input.companyName).toBeNull()
    expect(input.registrationNumber).toBeNull()
    expect(
      toCustomerInput(customer({ customerType: 'business', companyName: 'Kept' })).companyName,
    ).toBe('Kept')
  })
})

describe('edit helpers', () => {
  const stored: Customer = {
    id: 'c1',
    name: 'Cleo Client',
    email: 'c@x.co',
    phone: '+27824419082',
    altPhone: null,
    customerType: 'individual',
    segment: 'residential',
    idNumber: null,
    companyName: null,
    registrationNumber: null,
    streetAddress: null,
    suburb: null,
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: null,
    notes: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
  it('round-trips a stored customer through the form', () => {
    const { id, createdAt, updatedAt, ...input } = stored
    void id
    void createdAt
    void updatedAt
    expect(toCustomerInput(customerToForm(stored))).toEqual(input)
  })
  it('lists only the fields that would change', () => {
    const before = customerToForm(stored)
    expect(changedFieldLabels(before, before)).toEqual([])
    expect(changedFieldLabels(before, { ...before, city: 'Paarl', status: 'inactive' })).toEqual([
      'City',
      'Status',
    ])
    // Formatting-only differences are not changes.
    expect(
      changedFieldLabels(before, { ...before, phone: '082 441 9082', email: 'C@X.co' }),
    ).toEqual([])
  })
})

const property = (over: Partial<PropertyFormValues> = {}): PropertyFormValues => ({
  ...emptyPropertyForm,
  customerId: 'c1',
  address: '12 Long Street',
  ...over,
})

describe('validatePropertyForm', () => {
  it('accepts a minimal valid property', () => {
    expect(validatePropertyForm(property())).toEqual({})
  })
  it('requires an owner and an address', () => {
    expect(validatePropertyForm(property({ customerId: '' })).customerId).toBeDefined()
    expect(validatePropertyForm(property({ address: '  ' })).address).toBeDefined()
  })
  it('checks units, reference, postal code and province', () => {
    expect(validatePropertyForm(property({ units: '24' }))).toEqual({})
    for (const bad of ['0', '-3', '2.5', 'abc'])
      expect(validatePropertyForm(property({ units: bad })).units).toBeDefined()
    expect(validatePropertyForm(property({ reference: 'PROP-4015' }))).toEqual({})
    expect(validatePropertyForm(property({ reference: '!!' })).reference).toBeDefined()
    expect(validatePropertyForm(property({ postalCode: '12' })).postalCode).toBeDefined()
    expect(validatePropertyForm(property({ province: 'Narnia' })).province).toBeDefined()
  })
})

describe('toPropertyInput', () => {
  it('converts units to a number and blanks to null', () => {
    const input = toPropertyInput(
      property({ units: ' 24 ', name: ' ', reference: ' PROP-1 ', propertyType: 'mixed_use' }),
    )
    expect(input.units).toBe(24)
    expect(input.name).toBeNull()
    expect(input.reference).toBe('PROP-1')
    expect(input.propertyType).toBe('mixed_use')
    expect(toPropertyInput(property()).units).toBeNull()
  })
  it('round-trips through the form', () => {
    const form = property({ units: '8', city: 'Cape Town', propertyType: 'residential' })
    const input = toPropertyInput(form)
    expect(
      toPropertyInput(
        propertyToForm({
          ...input,
          id: 'p1',
          ownerName: 'Cleo',
          createdAt: '2026-01-01T00:00:00Z',
        }),
      ),
    ).toEqual(input)
  })
})
