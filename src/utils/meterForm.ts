import {
  METER_CATEGORIES,
  METER_TYPES,
  SERVICE_STATUSES,
  type MaintenanceInput,
  type MaintenanceKind,
  type MaintenancePriority,
  type MaintenanceStatus,
  type Meter,
  type MeterCategory,
  type MeterInput,
  type MeterType,
  type MeterUpdate,
  type NewMeterInput,
  type RetireInput,
  type ServiceStatus,
} from '@/types/meters'
import { businessToday } from './consumption'

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

/** A real calendar date as YYYY-MM-DD (rejects 2026-02-30, which Date would roll into March). */
export const isRealDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * A kWh register value: digits with up to three decimals. Spaces as thousands separators are fine.
 * A comma is refused rather than guessed: "1,500" could mean 1500 or 1.5.
 */
export function parseKwh(input: string): number | null {
  const s = input.replace(/\s/g, '')
  return /^\d{1,11}(\.\d{1,3})?$/.test(s) ? Number(s) : null
}

const KWH_HELP = 'Enter kWh as digits, for example 14850.5 (no commas).'

export interface MeterFormValues {
  propertyId: string
  serialNumber: string
  meterType: MeterType | ''
  category: MeterCategory | ''
  installedOn: string
  initialReading: string
  location: string
  installerName: string
  notes: string
  status: ServiceStatus
}
export type MeterFormErrors = Partial<Record<keyof MeterFormValues, string>>

export const emptyMeterForm: MeterFormValues = {
  propertyId: '',
  serialNumber: '',
  meterType: '',
  category: '',
  installedOn: '',
  initialReading: '',
  location: '',
  installerName: '',
  notes: '',
  status: 'active',
}

const serialError = (s: string): string | undefined => {
  if (!s.trim()) return 'Enter the serial number.'
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/ ]{2,39}$/.test(s.trim()))
    return 'Use 3 to 40 letters, numbers, dashes or slashes.'
  return undefined
}

export function validateMeterForm(
  v: MeterFormValues,
  mode: 'create' | 'edit',
  today = businessToday(),
): MeterFormErrors {
  const e: MeterFormErrors = {}
  const serial = serialError(v.serialNumber)
  if (serial) e.serialNumber = serial
  if (!METER_TYPES.some((t) => t.value === v.meterType)) e.meterType = 'Choose the meter type.'
  if (!METER_CATEGORIES.some((c) => c.value === v.category))
    e.category = 'Choose the meter category.'
  if (!v.propertyId) e.propertyId = 'Choose the property this meter is installed at.'
  if (!isRealDate(v.installedOn)) e.installedOn = 'Enter the installation date.'
  else if (v.installedOn > today) e.installedOn = 'The installation date cannot be in the future.'
  if (mode === 'create' && parseKwh(v.initialReading) === null) e.initialReading = KWH_HELP
  if (v.location.length > 200) e.location = 'Keep the location under 200 characters.'
  if (v.installerName.length > 120) e.installerName = 'Keep the name under 120 characters.'
  if (v.notes.length > 1000) e.notes = 'Keep the description under 1,000 characters.'
  if (!SERVICE_STATUSES.some((s) => s.value === v.status)) e.status = 'Choose a status.'
  return e
}

const toMeterInput = (v: MeterFormValues): MeterInput => ({
  propertyId: v.propertyId,
  serialNumber: v.serialNumber.trim(),
  meterType: v.meterType as MeterType,
  category: v.category as MeterCategory,
  installedOn: v.installedOn,
  location: orNull(v.location),
  installerName: orNull(v.installerName),
  notes: orNull(v.notes),
})

export const toNewMeter = (v: MeterFormValues): NewMeterInput => ({
  ...toMeterInput(v),
  initialReading: parseKwh(v.initialReading) ?? 0,
})

export const toMeterUpdate = (v: MeterFormValues, retired: boolean): MeterUpdate => ({
  ...toMeterInput(v),
  status: retired ? null : v.status,
})

export const meterToForm = (m: Meter): MeterFormValues => ({
  propertyId: m.propertyId,
  serialNumber: m.serialNumber,
  meterType: m.meterType ?? '',
  category: m.category ?? '',
  installedOn: m.installedOn ?? '',
  initialReading: '',
  location: m.location ?? '',
  installerName: m.installerName ?? '',
  notes: m.notes ?? '',
  status: SERVICE_STATUSES.some((s) => s.value === m.status)
    ? (m.status as ServiceStatus)
    : 'inactive',
})

// Replace / decommission -------------------------------------------------------------------------
export interface RetireFormValues {
  action: 'replace' | 'decommission'
  retiredOn: string
  finalReading: string
  newSerialNumber: string
  newInitialReading: string
  reason: string
}
export type RetireFormErrors = Partial<Record<keyof RetireFormValues, string>>

export function validateRetireForm(v: RetireFormValues, today = businessToday()): RetireFormErrors {
  const e: RetireFormErrors = {}
  if (!isRealDate(v.retiredOn)) e.retiredOn = 'Enter the date.'
  else if (v.retiredOn > today) e.retiredOn = 'The date cannot be in the future.'
  if (v.finalReading.trim() && parseKwh(v.finalReading) === null) e.finalReading = KWH_HELP
  if (v.action === 'replace') {
    const serial = serialError(v.newSerialNumber)
    if (serial) e.newSerialNumber = serial
    if (parseKwh(v.newInitialReading) === null) e.newInitialReading = KWH_HELP
  }
  if (v.reason.trim().length < 3) e.reason = 'Give the reason.'
  else if (v.reason.length > 500) e.reason = 'Keep the reason under 500 characters.'
  return e
}

export const toRetireInput = (v: RetireFormValues): RetireInput => ({
  retiredOn: v.retiredOn,
  reason: v.reason.trim(),
  finalReading: v.finalReading.trim() ? parseKwh(v.finalReading) : null,
  newSerialNumber: v.action === 'replace' ? v.newSerialNumber.trim() : '',
  newInitialReading: v.action === 'replace' ? (parseKwh(v.newInitialReading) ?? 0) : 0,
})

// Maintenance ------------------------------------------------------------------------------------
export interface MaintenanceFormValues {
  kind: MaintenanceKind
  issue: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  scheduledFor: string
  assignedTo: string
  outcome: string
}
export type MaintenanceFormErrors = Partial<Record<keyof MaintenanceFormValues, string>>

export const emptyMaintenanceForm: MaintenanceFormValues = {
  kind: 'inspection',
  issue: '',
  priority: 'routine',
  status: 'scheduled',
  scheduledFor: '',
  assignedTo: '',
  outcome: '',
}

export function validateMaintenanceForm(v: MaintenanceFormValues): MaintenanceFormErrors {
  const e: MaintenanceFormErrors = {}
  if (v.issue.trim().length < 3) e.issue = 'Describe the issue or task.'
  else if (v.issue.length > 500) e.issue = 'Keep the description under 500 characters.'
  if (v.scheduledFor && !isRealDate(v.scheduledFor)) e.scheduledFor = 'Enter a valid date.'
  else if (v.status === 'scheduled' && !v.scheduledFor)
    e.scheduledFor = 'Scheduled work needs a date.'
  if (v.status === 'completed' && v.outcome.trim().length < 3)
    e.outcome = 'Say what was done before completing the work.'
  else if (v.outcome.length > 1000) e.outcome = 'Keep the outcome under 1,000 characters.'
  return e
}

export const toMaintenanceInput = (v: MaintenanceFormValues): MaintenanceInput => ({
  kind: v.kind,
  issue: v.issue.trim(),
  priority: v.priority,
  status: v.status,
  scheduledFor: v.scheduledFor || null,
  assignedTo: v.assignedTo || null,
  outcome: orNull(v.outcome),
})
