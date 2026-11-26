import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { CustomerPicker } from '@/components/data/CustomerPicker'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { LineItemsEditor } from '@/components/sales/LineItemsEditor'
import { OrderTotalsList } from '@/components/sales/OrderTotalsList'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getBillingProfile, getInvoice, saveInvoice } from '@/services/invoices'
import { getCustomerPropertyOptions } from '@/services/orders'
import { getCustomerOption } from '@/services/properties'
import type { AppError, Result } from '@/types/api'
import { PAYMENT_TERMS, type BillingProfile, type PaymentTerms } from '@/types/invoices'
import type { CustomerOption } from '@/types/properties'
import { VAT_RATES } from '@/types/sales'
import { businessToday } from '@/utils/consumption'
import {
  emptyInvoiceForm,
  invoiceToForm,
  toInvoiceInput,
  validateInvoiceForm,
  type InvoiceFormErrors,
  type InvoiceFormValues,
} from '@/utils/invoiceForm'
import { clearLineErrors, firstLineErrorId, hasOrderErrors, totalsOf } from '@/utils/salesForm'
import { ok } from '@/utils/result'

interface InvoiceFormProps {
  initial: InvoiceFormValues
  initialCustomer: CustomerOption | null
  supplier: BillingProfile
  orderLabel?: string | null
  mode: 'create' | 'edit'
  submitting: boolean
  serverError: AppError | null
  cancelTo: string
  onSubmit: (values: InvoiceFormValues) => void
}

function InvoiceForm({
  initial,
  initialCustomer,
  supplier,
  orderLabel,
  mode,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: InvoiceFormProps) {
  const [values, setValues] = useState(initial)
  const [customer, setCustomer] = useState(initialCustomer)
  const [errors, setErrors] = useState<InvoiceFormErrors>({ line: {} })
  const properties = useResource(
    () =>
      values.customerId ? getCustomerPropertyOptions(values.customerId) : Promise.resolve(ok([])),
    `invoice-properties-${values.customerId}`,
  )
  const propertyOptions = properties.status === 'ready' ? properties.data : []
  // A business that is not VAT registered cannot charge VAT (the database refuses it too).
  const vatOptions = supplier.vatRegistered ? VAT_RATES : VAT_RATES.filter((v) => v.value === '0')

  const set = <K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateInvoiceForm(values)
    setErrors(found)
    if (hasOrderErrors(found)) {
      const id = found.customerId
        ? 'invoice-customerId'
        : (firstLineErrorId(values.lines, found) ??
          (found.dueDate
            ? 'invoice-dueDate'
            : found.discountPercent
              ? 'invoice-discountPercent'
              : null))
      if (id) document.getElementById(id)?.focus()
      return
    }
    onSubmit(values)
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-5">
        {serverError && serverError.field !== 'customerId' && (
          <FormError>{serverError.message}</FormError>
        )}
        <FormSection title="Invoice details">
          <div className="sm:col-span-2">
            {orderLabel && customer ? (
              <p className="text-body-md text-on-surface">
                For <strong>{customer.name}</strong> ({orderLabel})
              </p>
            ) : (
              <CustomerPicker
                id="invoice-customerId"
                label="Customer"
                selected={customer}
                error={errors.customerId}
                onSelect={(c) => {
                  setCustomer(c)
                  set('customerId', c?.id ?? '')
                  set('propertyId', '')
                }}
              />
            )}
          </div>
          <Select
            id="invoice-propertyId"
            label="Property (optional)"
            options={[
              { value: '', label: 'No property' },
              ...propertyOptions.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={propertyOptions.some((p) => p.id === values.propertyId) ? values.propertyId : ''}
            disabled={!values.customerId || properties.status !== 'ready'}
            onChange={(e) => set('propertyId', e.target.value)}
          />
          <Select
            id="invoice-paymentTerms"
            label="Payment terms"
            options={PAYMENT_TERMS}
            value={values.paymentTerms}
            onChange={(e) => set('paymentTerms', e.target.value as PaymentTerms)}
          />
          <Input
            id="invoice-dueDate"
            label="Due date (optional)"
            type="date"
            min={businessToday()}
            hint="Leave empty to set it from the terms when the invoice is issued."
            value={values.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
            error={errors.dueDate}
          />
        </FormSection>

        <LineItemsEditor
          lines={values.lines}
          errors={errors}
          onChange={(lines) => setValues((v) => ({ ...v, lines }))}
          onEdited={(key, fields) => setErrors((e) => clearLineErrors(e, key, fields))}
        />

        <FormSection title="Discount, VAT and notes">
          <Input
            id="invoice-discountPercent"
            label="Discount (%)"
            inputMode="decimal"
            value={values.discountPercent}
            onChange={(e) => set('discountPercent', e.target.value)}
            error={errors.discountPercent}
          />
          <Select
            id="invoice-vatRate"
            label="VAT"
            options={vatOptions}
            value={values.vatRate}
            hint={supplier.vatRegistered ? undefined : 'Your business is not VAT registered.'}
            onChange={(e) => set('vatRate', e.target.value)}
          />
          <div className="sm:col-span-2">
            <Textarea
              id="invoice-notes"
              label="Notes on the invoice (optional)"
              rows={3}
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              error={errors.notes}
            />
          </div>
        </FormSection>
      </div>

      <div className="flex flex-col gap-4 self-start lg:sticky lg:top-24">
        <Panel title="Invoice summary">
          <OrderTotalsList
            totals={totalsOf(values)}
            discountPercent={values.discountPercent.trim() || '0'}
            vatRate={values.vatRate}
          />
          <p className="mt-3 text-label-md text-on-surface-variant">
            Saved as a draft. It gets its number when you issue it.
          </p>
        </Panel>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to={cancelTo} className={secondaryLink}>
            Cancel
          </Link>
          <Button type="submit" loading={submitting}>
            {mode === 'create' ? 'Save Draft' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  )
}

interface Prefill {
  supplier: BillingProfile
  customer: CustomerOption | null
}

async function loadPrefill(customerId: string): Promise<Result<Prefill>> {
  const supplier = await getBillingProfile()
  if (!supplier.ok) return supplier
  if (!customerId) return ok({ supplier: supplier.data, customer: null })
  const customer = await getCustomerOption(customerId)
  return customer.ok ? ok({ supplier: supplier.data, customer: customer.data }) : customer
}

export function NewInvoiceScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const customerId = params.get('customer') ?? ''
  const prefill = useResource(() => loadPrefill(customerId), `invoice-prefill-${customerId}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const back = customerId
    ? { to: `/customers/${customerId}`, label: 'Customer profile' }
    : { to: '/invoices', label: 'Invoices' }

  return (
    <>
      <PageHeader title="Create Invoice" subtitle="Prices exclude VAT." back={back} />
      <ResourceBoundary state={prefill} skeletonLines={6}>
        {({ supplier, customer }) => (
          <InvoiceForm
            initial={{
              ...emptyInvoiceForm(supplier.defaultPaymentTerms, supplier.vatRegistered),
              customerId: customer?.id ?? '',
            }}
            initialCustomer={customer}
            supplier={supplier}
            mode="create"
            submitting={submitting}
            serverError={error}
            cancelTo={back.to}
            onSubmit={async (values) => {
              setSubmitting(true)
              setError(null)
              const result = await saveInvoice(null, toInvoiceInput(values))
              setSubmitting(false)
              if (result.ok) {
                navigate(`/invoices/${result.data.id}`, {
                  state: { notice: 'Draft invoice saved.' },
                })
              } else setError(result.error)
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

export function EditInvoiceScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(async () => {
    const [invoice, supplier] = await Promise.all([getInvoice(id), getBillingProfile()])
    if (!invoice.ok) return invoice
    if (!supplier.ok) return supplier
    return ok({ invoice: invoice.data, supplier: supplier.data })
  }, `invoice-edit-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  return (
    <>
      <PageHeader
        title="Edit Draft Invoice"
        subtitle={state.data?.invoice.customerName}
        back={{ to: `/invoices/${id}`, label: 'Invoice details' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {({ invoice, supplier }) =>
          invoice.status === 'draft' ? (
            <InvoiceForm
              key={invoice.id}
              initial={invoiceToForm(invoice)}
              initialCustomer={{
                id: invoice.customerId,
                name: invoice.customerName,
                companyName: null,
                email: null,
              }}
              supplier={supplier}
              orderLabel={invoice.orderReference && `from order ${invoice.orderReference}`}
              mode="edit"
              submitting={submitting}
              serverError={error}
              cancelTo={`/invoices/${id}`}
              onSubmit={async (values) => {
                setSubmitting(true)
                setError(null)
                const result = await saveInvoice(id, toInvoiceInput(values))
                setSubmitting(false)
                if (result.ok) navigate(`/invoices/${id}`, { state: { notice: 'Draft updated.' } })
                else setError(result.error)
              }}
            />
          ) : (
            <FormError>
              An issued invoice cannot be changed. To correct it, cancel it and issue a new one.
            </FormError>
          )
        }
      </ResourceBoundary>
    </>
  )
}
