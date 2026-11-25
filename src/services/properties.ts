import type { ListQuery, Page } from '@/types/customers'
import type {
  CustomerOption,
  MeterSummary,
  Property,
  PropertyInput,
  PropertyListItem,
  PropertySort,
  PropertyStatus,
  PropertyType,
  ReadingSummary,
} from '@/types/properties'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { embeddedCount, guarded, mapReadError, mapWriteError, num, one, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

function fromRow(r: Row): Property {
  const owner = one(r.customers as { name?: string } | { name?: string }[] | null)
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    ownerName: owner?.name ?? null,
    reference: str(r.reference),
    name: str(r.name),
    address: String(r.address),
    suburb: str(r.suburb),
    city: str(r.city),
    province: str(r.province),
    postalCode: str(r.postal_code),
    propertyType: str(r.property_type) as PropertyType | null,
    units: r.units === null || r.units === undefined ? null : num(r.units),
    status: String(r.status) as PropertyStatus,
    createdAt: String(r.created_at),
  }
}

function toRow(i: PropertyInput) {
  return {
    customer_id: i.customerId,
    reference: i.reference,
    name: i.name,
    address: i.address,
    suburb: i.suburb,
    city: i.city,
    province: i.province,
    postal_code: i.postalCode,
    property_type: i.propertyType,
    units: i.units,
    status: i.status,
  }
}

export interface PropertyFilters {
  type: PropertyType | ''
  status: PropertyStatus | ''
  /** Show only this customer's properties. */
  customerId: string
}

export const listProperties = (
  query: ListQuery<PropertySort>,
  filters: PropertyFilters,
  client?: DbClient,
) =>
  guarded<Page<PropertyListItem>>('Properties', client, async (c) => {
    let q = c
      .from('properties')
      .select(
        'id, reference, name, address, suburb, city, property_type, units, status, created_at, customers(name), electricity_meters(count)',
        { count: 'exact' },
      )
    if (filters.type) q = q.eq('property_type', filters.type)
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.customerId) q = q.eq('customer_id', filters.customerId)
    const or = orIlike(['name', 'address', 'suburb', 'city', 'reference'], query.search)
    if (or) q = q.or(or)

    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending })
      .order('id')
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Properties'))
    return ok({
      total: count ?? 0,
      rows: (data ?? []).map((r: Row) => ({
        id: String(r.id),
        reference: str(r.reference),
        name: str(r.name),
        address: String(r.address),
        suburb: str(r.suburb),
        city: str(r.city),
        propertyType: str(r.property_type) as PropertyType | null,
        units: r.units === null || r.units === undefined ? null : num(r.units),
        status: String(r.status) as PropertyStatus,
        ownerName: one(r.customers as { name?: string } | { name?: string }[] | null)?.name ?? null,
        meterCount: embeddedCount(r.electricity_meters),
      })),
    })
  })

export const getProperty = (id: string, client?: DbClient) =>
  guarded<Property>('Property', client, async (c) => {
    const { data, error } = await c
      .from('properties')
      .select('*, customers(name)')
      .eq('id', id)
      .maybeSingle()
    if (error) return err(mapReadError(error, 'Property'))
    if (!data) return err({ code: 'not_found', message: 'This property could not be found.' })
    return ok(fromRow(data as Row))
  })

export const createProperty = (input: PropertyInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'property',
    client,
    async (c) => {
      const { data, error } = await c.from('properties').insert(toRow(input)).select('id').single()
      if (error) return err(mapWriteError(error, 'property'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )

export const updateProperty = (id: string, input: PropertyInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'property',
    client,
    async (c) => {
      const { data, error } = await c
        .from('properties')
        .update(toRow(input))
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'property'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This property could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

export const getPropertyMeters = (propertyId: string, client?: DbClient) =>
  guarded<MeterSummary[]>('Meters', client, async (c) => {
    const { data, error } = await c
      .from('electricity_meters')
      .select('id, serial_number, status, installed_on')
      .eq('property_id', propertyId)
      .order('serial_number')
      .limit(50)
    if (error) return err(mapReadError(error, 'Meters'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        serialNumber: String(r.serial_number),
        status: String(r.status),
        installedOn: str(r.installed_on),
      })),
    )
  })

/** Latest readings across all of a property's meters: its service history until Phase 4 adds more. */
export const getPropertyReadings = (propertyId: string, client?: DbClient) =>
  guarded<ReadingSummary[]>('Meter readings', client, async (c) => {
    const { data, error } = await c
      .from('meter_readings')
      .select(
        'id, reading_date, reading_value, is_estimate, electricity_meters!inner(serial_number, property_id)',
      )
      .eq('electricity_meters.property_id', propertyId)
      .order('reading_date', { ascending: false })
      .limit(10)
    if (error) return err(mapReadError(error, 'Meter readings'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        serialNumber:
          one(
            r.electricity_meters as
              { serial_number?: string } | { serial_number?: string }[] | null,
          )?.serial_number ?? '',
        readingDate: String(r.reading_date),
        readingValue: num(r.reading_value),
        isEstimate: Boolean(r.is_estimate),
      })),
    )
  })

/** Customers matching a search, for the owner picker when registering a property. */
export const searchCustomerOptions = (search: string, client?: DbClient) =>
  guarded<CustomerOption[]>('Customers', client, async (c) => {
    let q = c
      .from('customers')
      .select('id, name, company_name, email')
      .neq('status', 'inactive')
      .order('name')
      .limit(8)
    const or = orIlike(['name', 'email', 'company_name'], search)
    if (or) q = q.or(or)
    const { data, error } = await q
    if (error) return err(mapReadError(error, 'Customers'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        name: String(r.name),
        companyName: str(r.company_name),
        email: str(r.email),
      })),
    )
  })

export const getCustomerOption = (id: string, client?: DbClient) =>
  guarded<CustomerOption>('Customer', client, async (c) => {
    const { data, error } = await c
      .from('customers')
      .select('id, name, company_name, email')
      .eq('id', id)
      .maybeSingle()
    if (error) return err(mapReadError(error, 'Customer'))
    if (!data) return err({ code: 'not_found', message: 'This customer could not be found.' })
    const r = data as Row
    return ok({
      id: String(r.id),
      name: String(r.name),
      companyName: str(r.company_name),
      email: str(r.email),
    })
  })
