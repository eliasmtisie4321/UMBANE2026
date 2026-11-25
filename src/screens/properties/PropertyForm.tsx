import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CustomerPicker } from '@/components/data/CustomerPicker'
import { FormSection } from '@/components/data/FormSection'
import { Button, Input, Select } from '@/components/ui'
import type { AppError } from '@/types/api'
import { PROVINCES } from '@/types/customers'
import {
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  type CustomerOption,
  type PropertyStatus,
  type PropertyType,
} from '@/types/properties'
import {
  validatePropertyForm,
  type PropertyFormErrors,
  type PropertyFormValues,
} from '@/utils/propertyForm'

interface PropertyFormProps {
  initial: PropertyFormValues
  /** The owner already chosen (prefilled from a customer profile, or when editing). */
  initialOwner: CustomerOption | null
  mode: 'create' | 'edit'
  submitting: boolean
  serverError?: AppError | null
  cancelTo: string
  onSubmit: (values: PropertyFormValues) => void
}

const FIELD_ORDER: Array<keyof PropertyFormValues> = [
  'customerId',
  'reference',
  'name',
  'propertyType',
  'units',
  'address',
  'suburb',
  'city',
  'province',
  'postalCode',
]

const TYPE_OPTIONS = [{ value: '', label: 'Select property type' }, ...PROPERTY_TYPES]
const PROVINCE_OPTIONS = [
  { value: '', label: 'Select province' },
  ...PROVINCES.map((p) => ({ value: p, label: p })),
]

export function PropertyForm({
  initial,
  initialOwner,
  mode,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: PropertyFormProps) {
  const [values, setValues] = useState(initial)
  const [owner, setOwner] = useState(initialOwner)
  const [errors, setErrors] = useState<PropertyFormErrors>({})
  const [dismissed, setDismissed] = useState<AppError | null>(null)

  const set = <K extends keyof PropertyFormValues>(key: K, value: PropertyFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
    setDismissed(serverError ?? null)
  }

  const activeServerError = serverError && serverError !== dismissed ? serverError : null
  const fieldError = (key: keyof PropertyFormValues) =>
    errors[key] ?? (activeServerError?.field === key ? activeServerError.message : undefined)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validatePropertyForm(values)
    setErrors(found)
    setDismissed(serverError ?? null)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) {
      document.getElementById(`prop-${first}`)?.focus()
      return
    }
    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {activeServerError && !activeServerError.field && (
        <p
          role="alert"
          className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {activeServerError.message}
        </p>
      )}

      <FormSection title="Property information">
        <div className="sm:col-span-2">
          <CustomerPicker
            id="prop-customerId"
            label="Owner"
            selected={owner}
            error={fieldError('customerId')}
            onSelect={(c) => {
              setOwner(c)
              set('customerId', c?.id ?? '')
            }}
          />
        </div>
        <Input
          id="prop-name"
          label="Property name"
          placeholder="e.g. Rosebank Link Precinct"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={fieldError('name')}
        />
        <Input
          id="prop-reference"
          label="Property ID"
          placeholder="e.g. PROP-4015"
          value={values.reference}
          onChange={(e) => set('reference', e.target.value)}
          error={fieldError('reference')}
          hint="Optional. Must be unique."
        />
        <Select
          id="prop-propertyType"
          label="Property type"
          options={TYPE_OPTIONS}
          value={values.propertyType}
          onChange={(e) => set('propertyType', e.target.value as PropertyType | '')}
          error={fieldError('propertyType')}
        />
        <Input
          id="prop-units"
          label="Number of units"
          placeholder="e.g. 24"
          inputMode="numeric"
          value={values.units}
          onChange={(e) => set('units', e.target.value)}
          error={fieldError('units')}
        />
        {mode === 'edit' && (
          <Select
            id="prop-status"
            label="Status"
            options={PROPERTY_STATUSES}
            value={values.status}
            onChange={(e) => set('status', e.target.value as PropertyStatus)}
            error={fieldError('status')}
          />
        )}
      </FormSection>

      <FormSection title="Address">
        <div className="sm:col-span-2">
          <Input
            id="prop-address"
            label="Street address"
            placeholder="e.g. 173 Oxford Road"
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
            error={fieldError('address')}
            required
          />
        </div>
        <Input
          id="prop-suburb"
          label="Suburb"
          placeholder="e.g. Rosebank"
          value={values.suburb}
          onChange={(e) => set('suburb', e.target.value)}
        />
        <Input
          id="prop-city"
          label="City"
          placeholder="e.g. Johannesburg"
          value={values.city}
          onChange={(e) => set('city', e.target.value)}
        />
        <Select
          id="prop-province"
          label="Province"
          options={PROVINCE_OPTIONS}
          value={values.province}
          onChange={(e) => set('province', e.target.value)}
          error={fieldError('province')}
        />
        <Input
          id="prop-postalCode"
          label="Postal code"
          placeholder="e.g. 2196"
          inputMode="numeric"
          value={values.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
          error={fieldError('postalCode')}
        />
      </FormSection>

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          to={cancelTo}
          className="inline-flex items-center justify-center rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container"
        >
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Register Property' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
