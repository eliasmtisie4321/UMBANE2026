import type { Customer, CustomerListItem } from '@/types/customers'
import type { Property, PropertyListItem } from '@/types/properties'

export const customerFixture = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  name: 'Cleo Client',
  email: 'client1@umbane.test',
  phone: '+27820000001',
  altPhone: null,
  customerType: 'individual',
  segment: 'residential',
  idNumber: '8805145028084',
  companyName: null,
  registrationNumber: null,
  streetAddress: '12 Long Street',
  suburb: 'City Bowl',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '8001',
  notes: 'Prefers email',
  status: 'active',
  createdAt: '2026-01-05T10:00:00Z',
  updatedAt: '2026-02-10T10:00:00Z',
  ...over,
})

export const customerRow = (over: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c1',
  name: 'Cleo Client',
  email: 'client1@umbane.test',
  phone: '+27824419082',
  customerType: 'individual',
  segment: 'residential',
  companyName: null,
  status: 'active',
  propertyCount: 2,
  createdAt: '2026-01-05T10:00:00Z',
  ...over,
})

export const propertyFixture = (over: Partial<Property> = {}): Property => ({
  id: 'p1',
  customerId: 'c1',
  ownerName: 'Cleo Client',
  reference: 'PROP-1001',
  name: 'Sunrise Apartments',
  address: '12 Long Street',
  suburb: 'City Bowl',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '8001',
  propertyType: 'residential',
  units: 24,
  status: 'active',
  createdAt: '2026-01-05T10:00:00Z',
  ...over,
})

export const propertyRow = (over: Partial<PropertyListItem> = {}): PropertyListItem => ({
  id: 'p1',
  reference: 'PROP-1001',
  name: 'Sunrise Apartments',
  address: '12 Long Street',
  suburb: 'City Bowl',
  city: 'Cape Town',
  propertyType: 'residential',
  units: 24,
  status: 'active',
  ownerName: 'Cleo Client',
  meterCount: 3,
  ...over,
})
