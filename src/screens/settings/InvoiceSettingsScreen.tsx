import { useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/useAuth'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormSection } from '@/components/data/FormSection'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getBillingProfile, updateBillingProfile } from '@/services/invoices'
import { PAYMENT_TERMS, type BillingProfile, type PaymentTerms } from '@/types/invoices'
import {
  billingToForm,
  toBillingProfile,
  validateBillingForm,
  type BillingFormErrors,
  type BillingFormValues,
} from '@/utils/invoiceForm'

const TEXT_FIELDS: Array<[keyof BillingFormValues, string]> = [
  ['name', 'Business name'],
  ['registrationNumber', 'Company registration number'],
  ['email', 'Accounts email'],
  ['phone', 'Phone number'],
]
const BANK_FIELDS: Array<[keyof BillingFormValues, string]> = [
  ['bankName', 'Bank name'],
  ['bankAccountName', 'Account holder'],
  ['bankAccountNumber', 'Account number'],
  ['bankBranchCode', 'Branch code'],
]

function SettingsForm({
  initial,
  readOnly,
  onSaved,
}: {
  initial: BillingProfile
  readOnly: boolean
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const [values, setValues] = useState(() => billingToForm(initial))
  const [errors, setErrors] = useState<BillingFormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof BillingFormValues>(key: K, value: BillingFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const field = ([key, label]: [keyof BillingFormValues, string]) => (
    <Input
      key={key}
      id={`billing-${key}`}
      label={label}
      readOnly={readOnly}
      value={values[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      error={errors[key]}
    />
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateBillingForm(values)
    setErrors(found)
    setServerError(null)
    const first = Object.keys(found)[0]
    if (first) return document.getElementById(`billing-${first}`)?.focus()
    if (!profile) return
    setSaving(true)
    const result = await updateBillingProfile(profile.business_id, toBillingProfile(values))
    setSaving(false)
    if (result.ok) onSaved()
    else setServerError(result.error.message)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-4xl flex-col gap-5">
      {readOnly && (
        <p className="rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          Only an administrator can change these details.
        </p>
      )}
      {serverError && <FormError>{serverError}</FormError>}
      <FormSection title="Business" description="Shown at the top of every invoice.">
        {TEXT_FIELDS.map(field)}
        <div className="sm:col-span-2">
          <Textarea
            id="billing-address"
            label="Billing address"
            rows={2}
            readOnly={readOnly}
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </div>
      </FormSection>
      <FormSection title="VAT">
        <div className="sm:col-span-2">
          <RadioGroup
            legend="VAT registration"
            value={values.vatRegistered ? 'yes' : 'no'}
            onChange={(v) => !readOnly && set('vatRegistered', v === 'yes')}
            options={[
              { value: 'yes', label: 'VAT registered (SARS)' },
              { value: 'no', label: 'Not VAT registered' },
            ]}
          />
        </div>
        {values.vatRegistered && field(['vatNumber', 'VAT number'])}
        <p className="self-end text-label-md text-on-surface-variant sm:col-span-2">
          VAT-registered businesses issue tax invoices at 15%. Others issue invoices without VAT.
        </p>
      </FormSection>
      <FormSection
        title="Payment details"
        description="How customers pay you, printed on invoices."
      >
        {BANK_FIELDS.map(field)}
        <Select
          id="billing-defaultPaymentTerms"
          label="Default payment terms"
          disabled={readOnly}
          options={PAYMENT_TERMS}
          value={values.defaultPaymentTerms}
          onChange={(e) => set('defaultPaymentTerms', e.target.value as PaymentTerms)}
        />
        <div className="sm:col-span-2">
          <Textarea
            id="billing-paymentInstructions"
            label="Payment instructions"
            rows={2}
            readOnly={readOnly}
            placeholder="e.g. Use your invoice number as the payment reference."
            value={values.paymentInstructions}
            onChange={(e) => set('paymentInstructions', e.target.value)}
            error={errors.paymentInstructions}
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            id="billing-invoiceFooter"
            label="Invoice footer"
            rows={2}
            readOnly={readOnly}
            value={values.invoiceFooter}
            onChange={(e) => set('invoiceFooter', e.target.value)}
            error={errors.invoiceFooter}
          />
        </div>
      </FormSection>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save Settings
          </Button>
        </div>
      )}
    </form>
  )
}

export default function InvoiceSettingsScreen() {
  const { profile } = useAuth()
  const state = useResource(() => getBillingProfile(), 'billing-profile')
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <>
      <PageHeader
        title="Invoice & Tax Settings"
        subtitle="Business, VAT and bank details printed on invoices."
      />
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={8}>
        {(data) => (
          <SettingsForm
            key={JSON.stringify(data)}
            initial={data}
            readOnly={profile?.role !== 'administrator'}
            onSaved={() => {
              setNotice('Settings saved.')
              state.reload()
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
