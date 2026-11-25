import {
  PROVINCES,
  SEGMENTS,
  type Customer,
  type CustomerInput,
  type CustomerStatus,
  type CustomerType,
  type Segment,
} from '@/types/customers'
import { isValidEmail } from './validation'
import { normalizePhone } from './phone'
import { isValidSaId } from './saId'

/** Form state: every field is a string so inputs stay controlled; conversion happens on save. */
export interface CustomerFormValues {
  name: string
  email: string
  phone: string
  altPhone: string
  customerType: CustomerType
  segment: Segment | ''
  idNumber: string
  companyName: string
  registrationNumber: string
  streetAddress: string
  suburb: string
  city: string
  province: string
  postalCode: string
  notes: string
  status: CustomerStatus
}

export type CustomerFormErrors = Partial<Record<keyof CustomerFormValues, string>>

export const emptyCustomerForm: CustomerFormValues = {
  name: '',
  email: '',
  phone: '',
  altPhone: '',
  customerType: 'individual',
  segment: '',
  idNumber: '',
  companyName: '',
  registrationNumber: '',
  streetAddress: '',
  suburb: '',
  city: '',
  province: '',
  postalCode: '',
  notes: '',
  status: 'active',
}

export const CUSTOMER_FIELD_LABELS: Record<keyof CustomerFormValues, string> = {
  name: 'Full name',
  email: 'Email address',
  phone: 'Phone number',
  altPhone: 'Alternative phone number',
  customerType: 'Customer type',
  segment: 'Segment',
  idNumber: 'ID number',
  companyName: 'Company name',
  registrationNumber: 'Business registration number',
  streetAddress: 'Street address',
  suburb: 'Suburb',
  city: 'City',
  province: 'Province',
  postalCode: 'Postal code',
  notes: 'Notes',
  status: 'Status',
}

const digitsOnly = (s: string) => s.replace(/[\s-]/g, '')

export function validateCustomerForm(v: CustomerFormValues): CustomerFormErrors {
  const e: CustomerFormErrors = {}
  if (v.name.trim().length < 2) e.name = 'Enter the customer’s full name.'

  const email = v.email.trim()
  const phone = v.phone.trim()
  if (email && !isValidEmail(email)) e.email = 'Enter a valid email address.'
  if (phone && !normalizePhone(phone)) e.phone = 'Enter a valid phone number, e.g. 082 441 9082.'
  if (!email && !phone) e.phone = 'Enter a phone number or an email address.'
  if (v.altPhone.trim() && !normalizePhone(v.altPhone)) {
    e.altPhone = 'Enter a valid phone number, e.g. 011 482 1900.'
  }

  if (v.idNumber.trim() && !isValidSaId(digitsOnly(v.idNumber))) {
    e.idNumber = 'Enter a valid 13-digit South African ID number.'
  }

  if (v.customerType === 'business') {
    if (!v.companyName.trim()) e.companyName = 'Enter the company name.'
    if (v.registrationNumber.trim() && !/^\d{4}\/\d{6}\/\d{2}$/.test(v.registrationNumber.trim())) {
      e.registrationNumber = 'Use the format 2019/482190/07.'
    }
  }

  if (v.postalCode.trim() && !/^\d{4}$/.test(v.postalCode.trim())) {
    e.postalCode = 'Postal codes have four digits.'
  }
  if (v.province && !(PROVINCES as readonly string[]).includes(v.province)) {
    e.province = 'Choose a province from the list.'
  }
  if (v.segment && !SEGMENTS.some((s) => s.value === v.segment))
    e.segment = 'Choose a segment from the list.'
  if (v.notes.length > 2000) e.notes = 'Notes can be at most 2,000 characters.'
  return e
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

/** Converts validated form values into what is stored: trimmed, normalised, empty as null. */
export function toCustomerInput(v: CustomerFormValues): CustomerInput {
  const business = v.customerType === 'business'
  return {
    name: v.name.trim(),
    email: orNull(v.email)?.toLowerCase() ?? null,
    phone: v.phone.trim() ? normalizePhone(v.phone) : null,
    altPhone: v.altPhone.trim() ? normalizePhone(v.altPhone) : null,
    customerType: v.customerType,
    segment: v.segment === '' ? null : v.segment,
    idNumber: orNull(digitsOnly(v.idNumber)),
    // A company name typed before switching back to "Individual" must not be saved.
    companyName: business ? orNull(v.companyName) : null,
    registrationNumber: business ? orNull(v.registrationNumber) : null,
    streetAddress: orNull(v.streetAddress),
    suburb: orNull(v.suburb),
    city: orNull(v.city),
    province: orNull(v.province),
    postalCode: orNull(v.postalCode),
    notes: orNull(v.notes),
    status: v.status,
  }
}

export function customerToForm(c: Customer): CustomerFormValues {
  return {
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    altPhone: c.altPhone ?? '',
    customerType: c.customerType,
    segment: c.segment ?? '',
    idNumber: c.idNumber ?? '',
    companyName: c.companyName ?? '',
    registrationNumber: c.registrationNumber ?? '',
    streetAddress: c.streetAddress ?? '',
    suburb: c.suburb ?? '',
    city: c.city ?? '',
    province: c.province ?? '',
    postalCode: c.postalCode ?? '',
    notes: c.notes ?? '',
    status: c.status,
  }
}

/** Labels of the fields whose stored value would change, for the "confirm changes" dialog. */
export function changedFieldLabels(
  before: CustomerFormValues,
  after: CustomerFormValues,
): string[] {
  const a = toCustomerInput(before)
  const b = toCustomerInput(after)
  const keys = Object.keys(CUSTOMER_FIELD_LABELS) as Array<keyof CustomerFormValues>
  return keys.filter((k) => a[k] !== b[k]).map((k) => CUSTOMER_FIELD_LABELS[k])
}
