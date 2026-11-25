import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FormSection } from '@/components/data/FormSection'
import { OptionPicker } from '@/components/data/OptionPicker'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { searchPropertyOptions } from '@/services/meters'
import type { AppError } from '@/types/api'
import {
  METER_CATEGORIES,
  METER_TYPES,
  SERVICE_STATUSES,
  type MeterCategory,
  type MeterType,
  type PropertyOption,
  type ServiceStatus,
} from '@/types/meters'
import { businessToday } from '@/utils/consumption'
import { validateMeterForm, type MeterFormErrors, type MeterFormValues } from '@/utils/meterForm'

interface MeterFormProps {
  initial: MeterFormValues
  initialProperty: PropertyOption | null
  mode: 'create' | 'edit'
  /** A retired meter's status is history, so it is not offered for editing. */
  retired?: boolean
  submitting: boolean
  serverError?: AppError | null
  cancelTo: string
  onSubmit: (values: MeterFormValues) => void
}

const FIELD_ORDER: Array<keyof MeterFormValues> = [
  'serialNumber',
  'meterType',
  'category',
  'initialReading',
  'propertyId',
  'installedOn',
  'installerName',
  'location',
  'notes',
]

const TYPE_OPTIONS = [{ value: '', label: 'Select meter type' }, ...METER_TYPES]
const CATEGORY_OPTIONS = [{ value: '', label: 'Select meter category' }, ...METER_CATEGORIES]

export function MeterForm({
  initial,
  initialProperty,
  mode,
  retired = false,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: MeterFormProps) {
  const [values, setValues] = useState(initial)
  const [property, setProperty] = useState(initialProperty)
  const [errors, setErrors] = useState<MeterFormErrors>({})
  const [dismissed, setDismissed] = useState<AppError | null>(null)

  const set = <K extends keyof MeterFormValues>(key: K, value: MeterFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
    setDismissed(serverError ?? null)
  }
  const active = serverError && serverError !== dismissed ? serverError : null
  const isFormField = (f: string | undefined) => f !== undefined && f in values
  const fieldError = (key: keyof MeterFormValues) =>
    errors[key] ?? (active?.field === key ? active.message : undefined)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateMeterForm(values, mode)
    setErrors(found)
    setDismissed(serverError ?? null)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) {
      document.getElementById(`meter-${first}`)?.focus()
      return
    }
    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {active && !isFormField(active.field) && (
        <p
          role="alert"
          className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {active.message}
        </p>
      )}

      <FormSection title="Meter specifications">
        <Input
          id="meter-serialNumber"
          label="Serial number"
          placeholder="e.g. MTR-ZA-88412"
          value={values.serialNumber}
          onChange={(e) => set('serialNumber', e.target.value)}
          error={fieldError('serialNumber')}
        />
        <Select
          id="meter-meterType"
          label="Meter type"
          options={TYPE_OPTIONS}
          value={values.meterType}
          onChange={(e) => set('meterType', e.target.value as MeterType | '')}
          error={fieldError('meterType')}
        />
        <Select
          id="meter-category"
          label="Meter category"
          options={CATEGORY_OPTIONS}
          value={values.category}
          onChange={(e) => set('category', e.target.value as MeterCategory | '')}
          error={fieldError('category')}
        />
        {mode === 'create' && (
          <Input
            id="meter-initialReading"
            label="Initial reading (kWh)"
            placeholder="e.g. 0"
            inputMode="decimal"
            value={values.initialReading}
            onChange={(e) => set('initialReading', e.target.value)}
            error={fieldError('initialReading')}
            hint="What the meter shows on the installation date."
          />
        )}
        {mode === 'edit' && !retired && (
          <Select
            id="meter-status"
            label="Status"
            options={SERVICE_STATUSES}
            value={values.status}
            onChange={(e) => set('status', e.target.value as ServiceStatus)}
            error={fieldError('status')}
            hint="To replace or decommission, use the button on the meter page."
          />
        )}
      </FormSection>

      <FormSection title="Installation">
        <div className="sm:col-span-2">
          <OptionPicker
            id="meter-propertyId"
            label="Property"
            noun="properties"
            placeholder="Search property by name, ID, address or city"
            selected={property}
            error={fieldError('propertyId')}
            search={(text) => searchPropertyOptions(text)}
            title={(p) => p.name}
            detail={(p) => p.detail}
            onSelect={(p) => {
              setProperty(p)
              set('propertyId', p?.id ?? '')
            }}
          />
        </div>
        <Input
          id="meter-installedOn"
          label="Installation date"
          type="date"
          max={businessToday()}
          value={values.installedOn}
          onChange={(e) => set('installedOn', e.target.value)}
          error={fieldError('installedOn')}
        />
        <Input
          id="meter-installerName"
          label="Installation technician (optional)"
          value={values.installerName}
          onChange={(e) => set('installerName', e.target.value)}
          error={fieldError('installerName')}
        />
        <div className="sm:col-span-2">
          <Input
            id="meter-location"
            label="Meter location (optional)"
            placeholder="e.g. Main LV distribution board, basement level 1"
            value={values.location}
            onChange={(e) => set('location', e.target.value)}
            error={fieldError('location')}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            id="meter-notes"
            label="Description (optional)"
            rows={3}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            error={fieldError('notes')}
          />
        </div>
      </FormSection>

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          to={cancelTo}
          className="inline-flex items-center justify-center rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container"
        >
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Save Meter' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
