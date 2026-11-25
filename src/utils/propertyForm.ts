import { PROVINCES } from '@/types/customers'
import {
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  type Property,
  type PropertyInput,
  type PropertyStatus,
  type PropertyType,
} from '@/types/properties'

export interface PropertyFormValues {
  customerId: string
  reference: string
  name: string
  propertyType: PropertyType | ''
  units: string
  address: string
  suburb: string
  city: string
  province: string
  postalCode: string
  status: PropertyStatus
}

export type PropertyFormErrors = Partial<Record<keyof PropertyFormValues, string>>

export const emptyPropertyForm: PropertyFormValues = {
  customerId: '',
  reference: '',
  name: '',
  propertyType: '',
  units: '',
  address: '',
  suburb: '',
  city: '',
  province: '',
  postalCode: '',
  status: 'active',
}

export function validatePropertyForm(v: PropertyFormValues): PropertyFormErrors {
  const e: PropertyFormErrors = {}
  if (!v.customerId) e.customerId = 'Choose the customer who owns this property.'
  if (!v.address.trim()) e.address = 'Enter the street address.'
  if (v.reference.trim() && !/^[A-Za-z0-9][A-Za-z0-9\-_/ ]{0,29}$/.test(v.reference.trim())) {
    e.reference = 'Use up to 30 letters, numbers, dashes or slashes, e.g. PROP-4015.'
  }
  if (v.units.trim() && !/^[1-9]\d{0,5}$/.test(v.units.trim())) {
    e.units = 'Enter a whole number of units, 1 or more.'
  }
  if (v.postalCode.trim() && !/^\d{4}$/.test(v.postalCode.trim()))
    e.postalCode = 'Postal codes have four digits.'
  if (v.province && !(PROVINCES as readonly string[]).includes(v.province)) {
    e.province = 'Choose a province from the list.'
  }
  if (v.propertyType && !PROPERTY_TYPES.some((t) => t.value === v.propertyType)) {
    e.propertyType = 'Choose a property type from the list.'
  }
  if (!PROPERTY_STATUSES.some((s) => s.value === v.status))
    e.status = 'Choose a status from the list.'
  return e
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function toPropertyInput(v: PropertyFormValues): PropertyInput {
  return {
    customerId: v.customerId,
    reference: orNull(v.reference),
    name: orNull(v.name),
    address: v.address.trim(),
    suburb: orNull(v.suburb),
    city: orNull(v.city),
    province: orNull(v.province),
    postalCode: orNull(v.postalCode),
    propertyType: v.propertyType === '' ? null : v.propertyType,
    units: v.units.trim() ? Number(v.units) : null,
    status: v.status,
  }
}

export function propertyToForm(p: Property): PropertyFormValues {
  return {
    customerId: p.customerId,
    reference: p.reference ?? '',
    name: p.name ?? '',
    propertyType: p.propertyType ?? '',
    units: p.units === null ? '' : String(p.units),
    address: p.address,
    suburb: p.suburb ?? '',
    city: p.city ?? '',
    province: p.province ?? '',
    postalCode: p.postalCode ?? '',
    status: p.status,
  }
}
