import type { ListQuery, Page } from '@/types/customers'
import type {
  ConsumptionMonth,
  Meter,
  MeterCategory,
  MeterListItem,
  MeterOption,
  MeterSort,
  MeterStatus,
  MeterSummaryCounts,
  MeterType,
  MeterUpdate,
  NewMeterInput,
  PropertyOption,
  Reading,
  ReadingFlag,
  ReadingInput,
  ReadingMethod,
  ReadingPoint,
  RetireInput,
} from '@/types/meters'
import { err, ok } from '@/utils/result'
import { orIlike } from '@/utils/search'
import { guarded, mapReadError, mapWriteError, num, one, type DbClient } from './db'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v))

export interface MeterFilters {
  type: MeterType | ''
  status: MeterStatus | ''
  propertyId: string
}

export const listMeters = (query: ListQuery<MeterSort>, filters: MeterFilters, client?: DbClient) =>
  guarded<Page<MeterListItem>>('Meters', client, async (c) => {
    let q = c.from('meter_directory').select('*', { count: 'exact' })
    if (filters.type) q = q.eq('meter_type', filters.type)
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.propertyId) q = q.eq('property_id', filters.propertyId)
    const or = orIlike(
      ['serial_number', 'property_name', 'property_address', 'property_reference', 'customer_name'],
      query.search,
    )
    if (or) q = q.or(or)

    const from = (query.page - 1) * query.pageSize
    const { data, error, count } = await q
      .order(query.sort, { ascending: query.ascending, nullsFirst: false })
      .order('id')
      .range(from, from + query.pageSize - 1)
    if (error) return err(mapReadError(error, 'Meters'))
    return ok({
      total: count ?? 0,
      rows: (data ?? []).map((r: Row) => ({
        id: String(r.id),
        serialNumber: String(r.serial_number),
        meterType: str(r.meter_type) as MeterType | null,
        status: String(r.status) as MeterStatus,
        installedOn: str(r.installed_on),
        propertyId: String(r.property_id),
        propertyName: str(r.property_name) ?? str(r.property_address) ?? '-',
        customerName: str(r.customer_name),
        latestDate: str(r.latest_date),
        latestValue: numOrNull(r.latest_value),
        latestIsEstimate: Boolean(r.latest_is_estimate),
        latestFlag: str(r.latest_flag) as ReadingFlag | null,
        estimatedMonthly: numOrNull(r.estimated_monthly),
      })),
    })
  })

export const getMeterSummary = (client?: DbClient) =>
  guarded<MeterSummaryCounts>('Meter totals', client, async (c) => {
    const { data, error } = await c.from('meter_summary').select('*').maybeSingle()
    if (error) return err(mapReadError(error, 'Meter totals'))
    const r = (data ?? {}) as Row
    return ok({
      inService: num(r.in_service),
      active: num(r.active),
      inactive: num(r.inactive),
      faulty: num(r.faulty),
      maintenance: num(r.maintenance),
      retired: num(r.retired),
    })
  })

export const getMeter = (id: string, client?: DbClient) =>
  guarded<Meter>('Meter', client, async (c) => {
    const { data, error } = await c
      .from('electricity_meters')
      .select('*, properties(name, address, city, reference, customer_id, customers(name))')
      .eq('id', id)
      .maybeSingle()
    // 22P02: the id in the address is not a UUID at all.
    if (error && error.code !== '22P02') return err(mapReadError(error, 'Meter'))
    if (!data) return err({ code: 'not_found', message: 'This meter could not be found.' })
    const r = data as Row
    const p = one(r.properties as Row | Row[] | null)
    const owner = one(p?.customers as Row | Row[] | null)
    return ok({
      id: String(r.id),
      serialNumber: String(r.serial_number),
      meterType: str(r.meter_type) as MeterType | null,
      category: str(r.category) as MeterCategory | null,
      status: String(r.status) as MeterStatus,
      installedOn: str(r.installed_on),
      location: str(r.location),
      installerName: str(r.installer_name),
      notes: str(r.notes),
      retiredOn: str(r.retired_on),
      retiredReason: str(r.retired_reason),
      replacedById: str(r.replaced_by_id),
      propertyId: String(r.property_id),
      propertyName: str(p?.name) ?? str(p?.address) ?? '-',
      propertyAddress: [p?.address, p?.city].filter(Boolean).join(', '),
      propertyReference: str(p?.reference),
      customerId: str(p?.customer_id),
      customerName: str(owner?.name),
    })
  })

export const registerMeter = (input: NewMeterInput, client?: DbClient) =>
  guarded<{ id: string }>(
    'meter',
    client,
    async (c) => {
      const { data, error } = await c.rpc('register_meter', {
        p_property_id: input.propertyId,
        p_serial_number: input.serialNumber,
        p_meter_type: input.meterType,
        p_category: input.category,
        p_installed_on: input.installedOn,
        p_initial_reading: input.initialReading,
        p_location: input.location,
        p_installer_name: input.installerName,
        p_notes: input.notes,
      })
      if (error) return err(mapWriteError(error, 'meter'))
      return ok({ id: String(data) })
    },
    mapWriteError,
  )

export const updateMeter = (id: string, input: MeterUpdate, client?: DbClient) =>
  guarded<{ id: string }>(
    'meter',
    client,
    async (c) => {
      const { data, error } = await c
        .from('electricity_meters')
        .update({
          property_id: input.propertyId,
          serial_number: input.serialNumber,
          meter_type: input.meterType,
          category: input.category,
          installed_on: input.installedOn,
          location: input.location,
          installer_name: input.installerName,
          notes: input.notes,
          ...(input.status === null ? {} : { status: input.status }),
        })
        .eq('id', id)
        .select('id')
      if (error) return err(mapWriteError(error, 'meter'))
      if (!data || data.length === 0) {
        return err({
          code: 'not_found',
          message:
            'This meter could not be updated. It may have been removed, or you may not have permission.',
        })
      }
      return ok({ id })
    },
    mapWriteError,
  )

/** Replaces the meter (returns the new meter's id) or decommissions it (returns null). */
export const retireMeter = (id: string, input: RetireInput, client?: DbClient) =>
  guarded<{ newMeterId: string | null }>(
    'meter',
    client,
    async (c) => {
      const { data, error } = await c.rpc('retire_meter', {
        p_meter_id: id,
        p_retired_on: input.retiredOn,
        p_reason: input.reason,
        p_final_reading: input.finalReading,
        p_new_serial_number: input.newSerialNumber || null,
        p_new_initial_reading: input.newInitialReading,
      })
      if (error) return err(mapWriteError(error, 'meter'))
      return ok({ newMeterId: str(data) })
    },
    mapWriteError,
  )

/** Newest first. */
export const getReadings = (meterId: string, page: number, pageSize: number, client?: DbClient) =>
  guarded<Page<Reading>>('Meter readings', client, async (c) => {
    const from = (page - 1) * pageSize
    const { data, error, count } = await c
      .from('meter_reading_history')
      .select('*', { count: 'exact' })
      .eq('meter_id', meterId)
      .order('reading_date', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) return err(mapReadError(error, 'Meter readings'))
    return ok({
      total: count ?? 0,
      rows: (data ?? []).map((r: Row) => ({
        id: String(r.id),
        readingDate: String(r.reading_date),
        readingValue: num(r.reading_value),
        isEstimate: Boolean(r.is_estimate),
        method: String(r.method) as ReadingMethod,
        notes: str(r.notes),
        flag: str(r.flag) as ReadingFlag | null,
        recordedByName: str(r.recorded_by_name),
        previousDate: str(r.previous_date),
        previousValue: numOrNull(r.previous_value),
        consumption: numOrNull(r.consumption),
        days: numOrNull(r.days),
        consumptionIsEstimate: Boolean(r.consumption_is_estimate),
      })),
    })
  })

/**
 * Readings around a date, for checking a new one as it is typed: the seven before it (the baseline
 * for "unusual"), any on the day itself, and the next one after.
 */
export const getReadingsAround = (meterId: string, date: string, client?: DbClient) =>
  guarded<ReadingPoint[]>('Previous readings', client, async (c) => {
    const base = () =>
      c.from('meter_readings').select('reading_date, reading_value').eq('meter_id', meterId)
    const [before, after] = await Promise.all([
      base().lt('reading_date', date).order('reading_date', { ascending: false }).limit(7),
      base().gte('reading_date', date).order('reading_date', { ascending: true }).limit(2),
    ])
    const error = before.error ?? after.error
    if (error) return err(mapReadError(error, 'Previous readings'))
    return ok(
      [...(before.data ?? []), ...(after.data ?? [])].map((r: Row) => ({
        readingDate: String(r.reading_date),
        readingValue: num(r.reading_value),
      })),
    )
  })

export const recordReading = (input: ReadingInput, client?: DbClient) =>
  guarded<{ id: string; flag: ReadingFlag | null }>(
    'reading',
    client,
    async (c) => {
      const { data, error } = await c
        .from('meter_readings')
        .insert({
          meter_id: input.meterId,
          reading_date: input.readingDate,
          reading_value: input.readingValue,
          is_estimate: input.isEstimate,
          method: input.method,
          notes: input.notes,
        })
        .select('id, flag')
        .single()
      if (error) return err(mapWriteError(error, 'reading'))
      const r = data as Row
      return ok({ id: String(r.id), flag: str(r.flag) as ReadingFlag | null })
    },
    mapWriteError,
  )

/** Managers and administrators only (enforced by the database; zero rows means not permitted). */
export const deleteReading = (id: string, client?: DbClient) =>
  guarded<void>(
    'reading',
    client,
    async (c) => {
      const { data, error } = await c.from('meter_readings').delete().eq('id', id).select('id')
      if (error) return err(mapWriteError(error, 'reading'))
      if (!data || data.length === 0) {
        return err({
          code: 'forbidden',
          message:
            'This reading could not be removed. Only a manager or administrator can do this.',
        })
      }
      return ok(undefined)
    },
    mapWriteError,
  )

const toMonth = (r: Row): ConsumptionMonth => ({
  month: String(r.month),
  kwh: num(r.kwh),
  daysCovered: numOrNull(r.days_covered),
  hasEstimate: Boolean(r.has_estimate),
})

/** The latest `months` months with consumption, oldest first. Months without readings are absent. */
export const getMeterConsumption = (meterId: string, months: number, client?: DbClient) =>
  guarded<ConsumptionMonth[]>('Consumption', client, async (c) => {
    const { data, error } = await c
      .from('meter_monthly_consumption')
      .select('month, kwh, days_covered, has_estimate')
      .eq('meter_id', meterId)
      .order('month', { ascending: false })
      .limit(months)
    if (error) return err(mapReadError(error, 'Consumption'))
    return ok((data ?? []).map(toMonth).reverse())
  })

export const getTotalConsumption = (months: number, client?: DbClient) =>
  guarded<ConsumptionMonth[]>('Consumption', client, async (c) => {
    const { data, error } = await c
      .from('monthly_consumption')
      .select('month, kwh, has_estimate')
      .order('month', { ascending: false })
      .limit(months)
    if (error) return err(mapReadError(error, 'Consumption'))
    return ok((data ?? []).map(toMonth).reverse())
  })

/** Meters still in service matching a search, for the meter picker. */
export const searchMeterOptions = (search: string, client?: DbClient) =>
  guarded<MeterOption[]>('Meters', client, async (c) => {
    let q = c
      .from('meter_directory')
      .select('id, serial_number, property_name, property_address, customer_name, installed_on')
      .not('status', 'in', '(replaced,decommissioned)')
      .order('serial_number')
      .limit(8)
    const or = orIlike(
      ['serial_number', 'property_name', 'property_address', 'customer_name'],
      search,
    )
    if (or) q = q.or(or)
    const { data, error } = await q
    if (error) return err(mapReadError(error, 'Meters'))
    return ok(
      (data ?? []).map((r: Row) => ({
        id: String(r.id),
        serialNumber: String(r.serial_number),
        propertyName: str(r.property_name) ?? str(r.property_address) ?? '-',
        customerName: str(r.customer_name),
        installedOn: str(r.installed_on),
      })),
    )
  })

const toPropertyOption = (r: Row): PropertyOption => ({
  id: String(r.id),
  name: str(r.name) ?? String(r.address),
  detail: [r.reference, r.address, r.city, one(r.customers as Row | Row[] | null)?.name]
    .filter(Boolean)
    .join(' · '),
})

export const searchPropertyOptions = (search: string, client?: DbClient) =>
  guarded<PropertyOption[]>('Properties', client, async (c) => {
    let q = c
      .from('properties')
      .select('id, name, reference, address, city, customers(name)')
      .order('name')
      .limit(8)
    const or = orIlike(['name', 'reference', 'address', 'city'], search)
    if (or) q = q.or(or)
    const { data, error } = await q
    if (error) return err(mapReadError(error, 'Properties'))
    return ok((data ?? []).map(toPropertyOption))
  })

export const getPropertyOption = (id: string, client?: DbClient) =>
  guarded<PropertyOption>('Property', client, async (c) => {
    const { data, error } = await c
      .from('properties')
      .select('id, name, reference, address, city, customers(name)')
      .eq('id', id)
      .maybeSingle()
    if (error) return err(mapReadError(error, 'Property'))
    if (!data) return err({ code: 'not_found', message: 'This property could not be found.' })
    return ok(toPropertyOption(data as Row))
  })
