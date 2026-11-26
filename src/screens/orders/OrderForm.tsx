import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/dashboard/Panel'
import { CustomerPicker } from '@/components/data/CustomerPicker'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { LineItemsEditor } from '@/components/sales/LineItemsEditor'
import { OrderTotalsList } from '@/components/sales/OrderTotalsList'
import { StaffSelect } from '@/components/sales/StaffSelect'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getCustomerPropertyOptions } from '@/services/orders'
import type { AppError } from '@/types/api'
import type { CustomerOption } from '@/types/properties'
import { PAYMENT_METHODS, VAT_RATES, type PaymentMethod } from '@/types/sales'
import { businessToday } from '@/utils/consumption'
import { ok } from '@/utils/result'
import {
  clearLineErrors,
  firstLineErrorId,
  hasOrderErrors,
  totalsOf,
  validateOrderForm,
  type OrderFormErrors,
  type OrderFormValues,
} from '@/utils/salesForm'

interface OrderFormProps {
  initial: OrderFormValues
  initialCustomer: CustomerOption | null
  assignedName?: string | null
  /** Shown when the order comes from a lead; the customer is then fixed. */
  leadLabel?: string | null
  mode: 'create' | 'edit'
  submitting: boolean
  serverError: AppError | null
  cancelTo: string
  onSubmit: (values: OrderFormValues) => void
}

export function OrderForm({
  initial,
  initialCustomer,
  assignedName,
  leadLabel,
  mode,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: OrderFormProps) {
  const [values, setValues] = useState(initial)
  const [customer, setCustomer] = useState(initialCustomer)
  const [errors, setErrors] = useState<OrderFormErrors>({ line: {} })

  const properties = useResource(
    () =>
      values.customerId ? getCustomerPropertyOptions(values.customerId) : Promise.resolve(ok([])),
    `order-properties-${values.customerId}`,
  )
  // Until the list for this customer arrives, do not offer the previous customer's properties.
  const propertyOptions = properties.status === 'ready' ? properties.data : []

  const set = <K extends keyof OrderFormValues>(key: K, value: OrderFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateOrderForm(values)
    setErrors(found)
    if (hasOrderErrors(found)) {
      const id = found.customerId
        ? 'order-customerId'
        : found.orderDate
          ? 'order-orderDate'
          : firstLineErrorId(values.lines, found)
            ? firstLineErrorId(values.lines, found)
            : found.discountPercent
              ? 'order-discountPercent'
              : null
      if (id) document.getElementById(id)?.focus()
      return
    }
    onSubmit(values)
  }

  const fieldError = (key: 'customerId' | 'orderDate' | 'discountPercent') =>
    errors[key] ?? (serverError?.field === key ? serverError.message : undefined)
  const totals = totalsOf(values)

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-5">
        {serverError && !['customerId', 'orderDate'].includes(serverError.field ?? '') && (
          <FormError>{serverError.message}</FormError>
        )}

        <FormSection title="Order details">
          <div className="sm:col-span-2">
            {leadLabel && customer ? (
              <p className="text-body-md text-on-surface">
                For <strong>{customer.name}</strong> ({leadLabel})
              </p>
            ) : (
              <CustomerPicker
                id="order-customerId"
                label="Customer"
                selected={customer}
                error={fieldError('customerId')}
                onSelect={(c) => {
                  setCustomer(c)
                  set('customerId', c?.id ?? '')
                  set('propertyId', '')
                }}
              />
            )}
          </div>
          <Select
            id="order-propertyId"
            label="Property (optional)"
            options={[
              { value: '', label: 'No property' },
              ...propertyOptions.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={propertyOptions.some((p) => p.id === values.propertyId) ? values.propertyId : ''}
            disabled={!values.customerId || properties.status !== 'ready'}
            error={
              properties.status === 'error' ? 'The properties could not be loaded.' : undefined
            }
            onChange={(e) => set('propertyId', e.target.value)}
          />
          <Input
            id="order-orderDate"
            label="Order date"
            type="date"
            max={businessToday()}
            value={values.orderDate}
            onChange={(e) => set('orderDate', e.target.value)}
            error={fieldError('orderDate')}
          />
          <StaffSelect
            id="order-assignedTo"
            label="Assigned to"
            value={values.assignedTo}
            currentName={assignedName}
            error={serverError?.field === 'assignedTo' ? serverError.message : undefined}
            onChange={(id) => set('assignedTo', id)}
          />
          <Select
            id="order-paymentMethod"
            label="Payment method (optional)"
            options={[{ value: '', label: 'Not decided' }, ...PAYMENT_METHODS]}
            value={values.paymentMethod}
            onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod | '')}
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
            id="order-discountPercent"
            label="Discount (%)"
            inputMode="decimal"
            value={values.discountPercent}
            onChange={(e) => set('discountPercent', e.target.value)}
            error={fieldError('discountPercent')}
          />
          <Select
            id="order-vatRate"
            label="VAT"
            options={VAT_RATES}
            value={values.vatRate}
            onChange={(e) => set('vatRate', e.target.value)}
          />
          <div className="sm:col-span-2">
            <Textarea
              id="order-notes"
              label="Notes (optional)"
              rows={3}
              hint="The customer can see these notes."
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              error={errors.notes}
            />
          </div>
        </FormSection>
      </div>

      <div className="flex flex-col gap-4 self-start lg:sticky lg:top-24">
        <Panel title="Order summary">
          <OrderTotalsList
            totals={totals}
            discountPercent={values.discountPercent.trim() || '0'}
            vatRate={values.vatRate}
          />
        </Panel>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to={cancelTo} className={secondaryLink}>
            Cancel
          </Link>
          <Button type="submit" loading={submitting}>
            {mode === 'create' ? 'Save Order' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  )
}
