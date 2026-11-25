import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FormSection } from '@/components/data/FormSection'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import type { AppError } from '@/types/api'
import { CUSTOMER_STATUSES, PROVINCES, SEGMENTS, type CustomerType } from '@/types/customers'
import {
  validateCustomerForm,
  type CustomerFormErrors,
  type CustomerFormValues,
} from '@/utils/customerForm'

interface CustomerFormProps {
  initial: CustomerFormValues
  mode: 'create' | 'edit'
  submitting: boolean
  /** Failure from saving. When it names a field (a duplicate email) it shows under that field. */
  serverError?: AppError | null
  cancelTo: string
  onSubmit: (values: CustomerFormValues) => void
}

/** Order used to move focus to the first problem after a failed submit. */
const FIELD_ORDER: Array<keyof CustomerFormValues> = [
  'name',
  'idNumber',
  'email',
  'phone',
  'altPhone',
  'segment',
  'companyName',
  'registrationNumber',
  'streetAddress',
  'suburb',
  'city',
  'province',
  'postalCode',
  'notes',
]

const SEGMENT_OPTIONS = [{ value: '', label: 'Not specified' }, ...SEGMENTS]
const PROVINCE_OPTIONS = [
  { value: '', label: 'Select province' },
  ...PROVINCES.map((p) => ({ value: p, label: p })),
]

export function CustomerForm({
  initial,
  mode,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: CustomerFormProps) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<CustomerFormErrors>({})
  // A server error stops applying once the person edits anything.
  const [dismissed, setDismissed] = useState<AppError | null>(null)

  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
    setDismissed(serverError ?? null)
  }

  const activeServerError = serverError && serverError !== dismissed ? serverError : null
  const fieldError = (key: keyof CustomerFormValues) =>
    errors[key] ?? (activeServerError?.field === key ? activeServerError.message : undefined)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateCustomerForm(values)
    setErrors(found)
    setDismissed(serverError ?? null)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) {
      document.getElementById(`cust-${first}`)?.focus()
      return
    }
    onSubmit(values)
  }

  const business = values.customerType === 'business'

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

      <FormSection title="Personal information">
        <Input
          id="cust-name"
          label="Full name"
          placeholder="e.g. Thabo Mokoena"
          autoComplete="off"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={fieldError('name')}
          required
        />
        <Input
          id="cust-idNumber"
          label="ID number"
          placeholder="13-digit SA ID (optional)"
          inputMode="numeric"
          value={values.idNumber}
          onChange={(e) => set('idNumber', e.target.value)}
          error={fieldError('idNumber')}
          hint="Stored securely and shown masked on the profile."
        />
        <Input
          id="cust-email"
          label="Email address"
          type="email"
          placeholder="thabo@example.co.za"
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          error={fieldError('email')}
        />
        <Input
          id="cust-phone"
          label="Phone number"
          type="tel"
          placeholder="+27 82 441 9082"
          value={values.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={fieldError('phone')}
          hint="An email address or a phone number is required."
        />
        <Input
          id="cust-altPhone"
          label="Alternative phone number"
          type="tel"
          placeholder="+27 11 482 1900 (optional)"
          value={values.altPhone}
          onChange={(e) => set('altPhone', e.target.value)}
          error={fieldError('altPhone')}
        />
      </FormSection>

      <FormSection title="Customer type">
        <div className="sm:col-span-2">
          <RadioGroup<CustomerType>
            legend="This customer is"
            value={values.customerType}
            options={[
              { value: 'individual', label: 'Individual' },
              { value: 'business', label: 'Business' },
            ]}
            onChange={(v) => set('customerType', v)}
          />
        </div>
        <Select
          id="cust-segment"
          label="Segment"
          options={SEGMENT_OPTIONS}
          value={values.segment}
          onChange={(e) => set('segment', e.target.value as CustomerFormValues['segment'])}
          error={fieldError('segment')}
        />
        {mode === 'edit' && (
          <Select
            id="cust-status"
            label="Status"
            options={CUSTOMER_STATUSES}
            value={values.status}
            onChange={(e) => set('status', e.target.value as CustomerFormValues['status'])}
          />
        )}
      </FormSection>

      {business && (
        <FormSection title="Business information">
          <Input
            id="cust-companyName"
            label="Company name"
            placeholder="e.g. Kagiso Logistics (Pty) Ltd"
            value={values.companyName}
            onChange={(e) => set('companyName', e.target.value)}
            error={fieldError('companyName')}
            required
          />
          <Input
            id="cust-registrationNumber"
            label="Business registration number"
            placeholder="e.g. 2019/482190/07"
            value={values.registrationNumber}
            onChange={(e) => set('registrationNumber', e.target.value)}
            error={fieldError('registrationNumber')}
          />
        </FormSection>
      )}

      <FormSection title="Address">
        <div className="sm:col-span-2">
          <Input
            id="cust-streetAddress"
            label="Street address"
            placeholder="e.g. 142 Rivonia Road"
            value={values.streetAddress}
            onChange={(e) => set('streetAddress', e.target.value)}
            error={fieldError('streetAddress')}
          />
        </div>
        <Input
          id="cust-suburb"
          label="Suburb"
          placeholder="e.g. Sandown"
          value={values.suburb}
          onChange={(e) => set('suburb', e.target.value)}
        />
        <Input
          id="cust-city"
          label="City"
          placeholder="e.g. Sandton"
          value={values.city}
          onChange={(e) => set('city', e.target.value)}
        />
        <Select
          id="cust-province"
          label="Province"
          options={PROVINCE_OPTIONS}
          value={values.province}
          onChange={(e) => set('province', e.target.value)}
          error={fieldError('province')}
        />
        <Input
          id="cust-postalCode"
          label="Postal code"
          placeholder="e.g. 2196"
          inputMode="numeric"
          value={values.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
          error={fieldError('postalCode')}
        />
      </FormSection>

      <FormSection title="Notes">
        <div className="sm:col-span-2">
          <Textarea
            id="cust-notes"
            label="Customer notes"
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            error={fieldError('notes')}
            hint="Visible to your team only."
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
          {mode === 'create' ? 'Save Customer' : 'Review changes'}
        </Button>
      </div>
    </form>
  )
}
