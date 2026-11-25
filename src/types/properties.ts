export type PropertyType = 'residential' | 'commercial' | 'industrial' | 'mixed_use'
export type PropertyStatus = 'active' | 'maintenance' | 'offline'

export const PROPERTY_TYPES: Array<{ value: PropertyType; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed_use', label: 'Mixed-Use' },
]

export const PROPERTY_STATUSES: Array<{ value: PropertyStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'offline', label: 'Offline' },
]

export interface Property {
  id: string
  customerId: string
  ownerName: string | null
  reference: string | null
  name: string | null
  address: string
  suburb: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  propertyType: PropertyType | null
  units: number | null
  status: PropertyStatus
  createdAt: string
}

export type PropertyInput = Omit<Property, 'id' | 'ownerName' | 'createdAt'>

export interface PropertyListItem {
  id: string
  reference: string | null
  name: string | null
  address: string
  suburb: string | null
  city: string | null
  propertyType: PropertyType | null
  units: number | null
  status: PropertyStatus
  ownerName: string | null
  meterCount: number
}

export type PropertySort = 'name' | 'created_at' | 'status'

export interface MeterSummary {
  id: string
  serialNumber: string
  status: string
  installedOn: string | null
}

export interface ReadingSummary {
  id: string
  serialNumber: string
  readingDate: string
  readingValue: number
  isEstimate: boolean
}

export interface CustomerOption {
  id: string
  name: string
  companyName: string | null
  email: string | null
}
