export type MeterType = 'three_phase_ct' | 'smart_prepaid' | 'conventional' | 'split_keypad'
export type MeterCategory = 'commercial_bulk' | 'residential_sub' | 'industrial_hv' | 'common_area'
/** Statuses a person sets directly. Replaced and decommissioned happen through retiring. */
export type ServiceStatus = 'active' | 'maintenance' | 'faulty' | 'inactive'
export type MeterStatus = ServiceStatus | 'replaced' | 'decommissioned'
export type ReadingMethod = 'manual' | 'handheld' | 'customer' | 'remote'
export type ReadingFlag = 'high' | 'low'

export const METER_TYPES: Array<{ value: MeterType; label: string }> = [
  { value: 'three_phase_ct', label: 'Three-Phase CT' },
  { value: 'smart_prepaid', label: 'Smart Prepaid' },
  { value: 'conventional', label: 'Conventional' },
  { value: 'split_keypad', label: 'Split Keypad STS' },
]

export const METER_CATEGORIES: Array<{ value: MeterCategory; label: string }> = [
  { value: 'commercial_bulk', label: 'Commercial Bulk' },
  { value: 'residential_sub', label: 'Residential Sub-Meter' },
  { value: 'industrial_hv', label: 'Industrial High-Voltage' },
  { value: 'common_area', label: 'Common Area / Essential' },
]

export const SERVICE_STATUSES: Array<{ value: ServiceStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'inactive', label: 'Inactive' },
]

export const METER_STATUSES: Array<{ value: MeterStatus; label: string }> = [
  ...SERVICE_STATUSES,
  { value: 'replaced', label: 'Replaced' },
  { value: 'decommissioned', label: 'Decommissioned' },
]

export const READING_METHODS: Array<{ value: ReadingMethod; label: string }> = [
  { value: 'manual', label: 'Manual field capture' },
  { value: 'handheld', label: 'Optical probe / handheld' },
  { value: 'customer', label: 'Customer self-submission' },
  { value: 'remote', label: 'Remote / smart meter' },
]

export interface MeterListItem {
  id: string
  serialNumber: string
  meterType: MeterType | null
  status: MeterStatus
  installedOn: string | null
  propertyId: string
  propertyName: string
  customerName: string | null
  latestDate: string | null
  latestValue: number | null
  latestIsEstimate: boolean
  latestFlag: ReadingFlag | null
  estimatedMonthly: number | null
}

export type MeterSort = 'serial_number' | 'status' | 'installed_on' | 'latest_date'

export interface Meter {
  id: string
  serialNumber: string
  meterType: MeterType | null
  category: MeterCategory | null
  status: MeterStatus
  installedOn: string | null
  location: string | null
  installerName: string | null
  notes: string | null
  retiredOn: string | null
  retiredReason: string | null
  replacedById: string | null
  propertyId: string
  propertyName: string
  propertyAddress: string
  propertyReference: string | null
  customerId: string | null
  customerName: string | null
}

export interface MeterInput {
  propertyId: string
  serialNumber: string
  meterType: MeterType
  category: MeterCategory
  installedOn: string
  location: string | null
  installerName: string | null
  notes: string | null
}

export interface NewMeterInput extends MeterInput {
  initialReading: number
}

export interface MeterUpdate extends MeterInput {
  /** Null leaves the status alone (a retired meter's status is not edited). */
  status: ServiceStatus | null
}

export interface RetireInput {
  retiredOn: string
  reason: string
  finalReading: number | null
  /** Empty = decommission without a replacement. */
  newSerialNumber: string
  newInitialReading: number
}

export interface MeterSummaryCounts {
  inService: number
  active: number
  inactive: number
  faulty: number
  maintenance: number
  retired: number
}

export interface Reading {
  id: string
  readingDate: string
  readingValue: number
  isEstimate: boolean
  method: ReadingMethod
  notes: string | null
  flag: ReadingFlag | null
  recordedByName: string | null
  previousDate: string | null
  previousValue: number | null
  consumption: number | null
  days: number | null
  consumptionIsEstimate: boolean
}

export interface ReadingPoint {
  readingDate: string
  readingValue: number
}

export interface ReadingInput {
  meterId: string
  readingDate: string
  readingValue: number
  isEstimate: boolean
  method: ReadingMethod
  notes: string | null
}

export interface ConsumptionMonth {
  month: string
  kwh: number
  /** Days of the month covered by readings; null for totals across several meters. */
  daysCovered: number | null
  hasEstimate: boolean
}

export interface MeterOption {
  id: string
  serialNumber: string
  propertyName: string
  customerName: string | null
  installedOn: string | null
}

export interface PropertyOption {
  id: string
  name: string
  detail: string
}

export type MaintenanceKind =
  'inspection' | 'repair' | 'calibration' | 'replacement' | 'decommission'
export type MaintenancePriority = 'urgent' | 'high' | 'medium' | 'routine'
export type MaintenanceStatus = 'scheduled' | 'pending' | 'in_progress' | 'completed' | 'cancelled'

/** Replacement and decommission records are created by retiring a meter, so they are not offered. */
export const MAINTENANCE_KINDS: Array<{ value: MaintenanceKind; label: string }> = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'repair', label: 'Repair' },
  { value: 'calibration', label: 'Calibration' },
]

export const MAINTENANCE_PRIORITIES: Array<{ value: MaintenancePriority; label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'routine', label: 'Routine' },
]

export const MAINTENANCE_STATUSES: Array<{ value: MaintenanceStatus; label: string }> = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export interface MaintenanceItem {
  id: string
  reference: string
  meterId: string
  serialNumber: string
  propertyName: string
  customerName: string | null
  kind: MaintenanceKind
  issue: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  scheduledFor: string | null
  assignedTo: string | null
  assignedName: string | null
  outcome: string | null
  completedOn: string | null
  createdAt: string
  isOverdue: boolean
}

export type MaintenanceSort = 'priority_rank' | 'scheduled_for' | 'created_at'

export interface MaintenanceInput {
  kind: MaintenanceKind
  issue: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  scheduledFor: string | null
  assignedTo: string | null
  outcome: string | null
}

export interface MaintenanceCounts {
  scheduled: number
  pending: number
  inProgress: number
  completed: number
  urgent: number
  overdue: number
}

export interface StaffOption {
  id: string
  name: string
}
