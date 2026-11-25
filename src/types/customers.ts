export type CustomerType = 'individual' | 'business'
export type Segment = 'residential' | 'commercial' | 'industrial' | 'municipal'
export type CustomerStatus = 'active' | 'pending' | 'inactive'

export const PROVINCES = [
  'Gauteng',
  'Western Cape',
  'KwaZulu-Natal',
  'Eastern Cape',
  'Free State',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
] as const

export const SEGMENTS: Array<{ value: Segment; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'municipal', label: 'Municipal' },
]

export const CUSTOMER_STATUSES: Array<{ value: CustomerStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'inactive', label: 'Inactive' },
]

/** A customer as stored. Optional details are null, never empty strings. */
export interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
  altPhone: string | null
  customerType: CustomerType
  segment: Segment | null
  idNumber: string | null
  companyName: string | null
  registrationNumber: string | null
  streetAddress: string | null
  suburb: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  notes: string | null
  status: CustomerStatus
  createdAt: string
  updatedAt: string
}

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>

export interface CustomerListItem {
  id: string
  name: string
  email: string | null
  phone: string | null
  customerType: CustomerType
  segment: Segment | null
  companyName: string | null
  status: CustomerStatus
  propertyCount: number
  createdAt: string
}

export type CustomerSort = 'name' | 'created_at' | 'status'

export interface ListQuery<Sort extends string> {
  search: string
  sort: Sort
  ascending: boolean
  /** 1-based. */
  page: number
  pageSize: number
}

export interface Page<T> {
  rows: T[]
  total: number
}

export interface RelatedProperty {
  id: string
  reference: string | null
  name: string | null
  address: string
  city: string | null
  status: string
  meterCount: number
}

export interface RelatedOrder {
  id: string
  status: string
  total: number
  createdAt: string
}

export interface RelatedTicket {
  id: string
  reference: string
  subject: string
  status: string
  priority: string
  createdAt: string
}
