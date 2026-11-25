import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppError, Result } from '@/types/api'
import { err } from '@/utils/result'
import { getSupabase } from './supabase'

/** The slice of the Supabase client the data services use; tests pass a fake. */
export type DbClient = Pick<SupabaseClient, 'from' | 'rpc'>

export interface DbError {
  code?: string
  message?: string
  details?: string
}

export const resolveClient = (client?: DbClient): DbClient => client ?? getSupabase()

/** Read failures. Raw database text is never shown to users. */
export function mapReadError(e: DbError, what: string): AppError {
  if (e.code === '42501') {
    return { code: 'forbidden', message: 'You do not have access to this information.' }
  }
  if (e.code === 'PGRST205' || e.code === '42P01') {
    return {
      code: 'unknown',
      message: `${what} is unavailable until the latest database update is applied.`,
    }
  }
  if (/failed to fetch|network/i.test(e.message ?? '')) {
    return {
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    }
  }
  return { code: 'unknown', message: `Could not load ${what}. Please try again.` }
}

/** Unique indexes from the migrations, mapped to the form field and message a person can act on. */
const UNIQUE_VIOLATIONS: Record<string, { field: string; message: string }> = {
  customers_business_email_uniq: {
    field: 'email',
    message: 'A customer with this email address already exists.',
  },
  customers_business_id_number_uniq: {
    field: 'idNumber',
    message: 'A customer with this ID number already exists.',
  },
  customers_business_registration_uniq: {
    field: 'registrationNumber',
    message: 'A customer with this registration number already exists.',
  },
  properties_business_reference_uniq: {
    field: 'reference',
    message: 'A property with this reference already exists.',
  },
  meters_business_serial_ci_uniq: {
    field: 'serialNumber',
    message: 'A meter with this serial number already exists.',
  },
  electricity_meters_business_id_serial_number_key: {
    field: 'serialNumber',
    message: 'A meter with this serial number already exists.',
  },
  meter_readings_meter_id_reading_date_key: {
    field: 'readingDate',
    message: 'This meter already has a reading on this date.',
  },
  properties_customer_address_uniq: {
    field: 'address',
    message: 'This customer already has a property at this address.',
  },
}

/** Rules raised by database triggers (migration 0006), as text a person can act on. */
const RULES: Record<string, { field?: string; message: string }> = {
  reading_below_previous: {
    field: 'readingValue',
    message: 'This is below the previous reading. Check the value and the date.',
  },
  reading_above_next: {
    field: 'readingValue',
    message: 'This is above a later reading. Check the value and the date.',
  },
  reading_in_future: { field: 'readingDate', message: 'A reading cannot be in the future.' },
  reading_before_install: {
    field: 'readingDate',
    message: 'This is before the meter was installed.',
  },
  reading_after_retirement: {
    field: 'readingDate',
    message: 'This is after the meter was taken out of service.',
  },
  meter_installed_in_future: {
    field: 'installedOn',
    message: 'The installation date cannot be in the future.',
  },
  meter_installed_after_reading: {
    field: 'installedOn',
    message: 'This meter already has readings before that date.',
  },
  meter_retired_in_future: { field: 'retiredOn', message: 'The date cannot be in the future.' },
  meter_retired_before_reading: {
    field: 'retiredOn',
    message: 'This meter has a reading after that date.',
  },
  meters_retired_after_install: {
    field: 'retiredOn',
    message: 'This is before the meter was installed.',
  },
  meter_retired: {
    message: 'This meter has already been taken out of service. Refresh the page.',
  },
  maintenance_assignee_not_staff: {
    field: 'assignedTo',
    message: 'Choose a current team member.',
  },
}

/** Write failures: duplicates, constraint violations, permissions. */
export function mapWriteError(e: DbError, what: string): AppError {
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  if (e.code === '23505') {
    const known = Object.entries(UNIQUE_VIOLATIONS).find(([name]) => text.includes(name))
    return known
      ? { code: 'conflict', message: known[1].message, field: known[1].field }
      : { code: 'conflict', message: `This ${what} already exists.` }
  }
  if (e.code === '23514') {
    // Longest name first: "meter_retired" is also the start of other rule names.
    const rule = Object.keys(RULES)
      .sort((a, b) => b.length - a.length)
      .find((name) => text.includes(name))
    if (rule) return { code: 'validation', ...RULES[rule] }
  }
  if (e.code === '23514' || e.code === '22P02' || e.code === '23502') {
    return {
      code: 'validation',
      message: 'Some of the details are not valid. Check the form and try again.',
    }
  }
  if (e.code === '23503') {
    return {
      code: 'validation',
      message: 'A linked record no longer exists. Refresh the page and try again.',
    }
  }
  if (e.code === '42501') {
    return { code: 'forbidden', message: 'You do not have permission to do this.' }
  }
  if (/failed to fetch|network/i.test(e.message ?? '')) {
    return {
      code: 'network',
      message: 'Cannot reach the server. Check your connection and try again.',
    }
  }
  return { code: 'unknown', message: `Could not save the ${what}. Please try again.` }
}

type Mapper = (e: DbError, what: string) => AppError

/** Runs a query function, turning thrown errors into a Result with the right message. */
export async function guarded<T>(
  what: string,
  client: DbClient | undefined,
  fn: (c: DbClient) => Promise<Result<T>>,
  map: Mapper = mapReadError,
): Promise<Result<T>> {
  try {
    return await fn(resolveClient(client))
  } catch (e) {
    return err(map(e as DbError, what))
  }
}

export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** PostgREST returns a joined many-to-one row as an object, but tolerate an array too. */
export const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

/** The `count` from an embedded `table(count)` select, which arrives as [{ count: n }]. */
export const embeddedCount = (v: unknown): number => {
  const first = Array.isArray(v) ? v[0] : v
  return num((first as { count?: unknown } | undefined)?.count)
}
