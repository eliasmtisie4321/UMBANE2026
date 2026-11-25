import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/dashboard/Panel'
import { CustomerPicker } from '@/components/data/CustomerPicker'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { OptionPicker } from '@/components/data/OptionPicker'
import { OrderTotalsList } from '@/components/sales/OrderTotalsList'
import { StaffSelect } from '@/components/sales/StaffSelect'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getCustomerPropertyOptions, searchProducts } from '@/services/orders'
import type { AppError } from '@/types/api'
import type { CustomerOption } from '@/types/properties'
import { PAYMENT_METHODS, VAT_RATES, type PaymentMethod, type ProductOption } from '@/types/sales'
import { businessToday } from '@/utils/consumption'
import { formatRand } from '@/utils/format'
import { ok } from '@/utils/result'
import {
  blankLine,
  hasOrderErrors,
  totalsOf,
  validateOrderForm,
  type OrderFormErrors,
  type OrderFormValues,
  type OrderLine,
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
  const [choosing, setChoosing] = useState(false)
  const nextKey = useRef(Math.max(0, ...initial.lines.map((l) => l.key)) + 1)

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
  const setLine = (key: number, patch: Partial<OrderLine>) => {
    setValues((v) => ({
      ...v,
      lines: v.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }))
    setErrors((e) => {
      const line = { ...e.line, [key]: { ...e.line[key] } }
      for (const field of Object.keys(patch) as Array<keyof OrderLine>)
        delete line[key][field as keyof (typeof line)[number]]
      return { ...e, line, lines: undefined }
    })
  }
  const addLine = (line: Partial<OrderLine> = {}) => {
    const key = nextKey.current++
    setValues((v) => ({ ...v, lines: [...v.lines, { ...blankLine(key), ...line }] }))
    setErrors((e) => ({ ...e, lines: undefined }))
  }

  function chooseProduct(p: ProductOption | null) {
    if (!p) return
    const line = {
      productId: p.id,
      description: p.name,
      unitPrice: p.unitPrice.toFixed(2),
    }
    // The first, still blank line is filled in rather than left behind.
    const blank = values.lines.find((l) => !l.productId && !l.description && !l.unitPrice)
    if (blank) setLine(blank.key, line)
    else addLine(line)
    setChoosing(false)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateOrderForm(values)
    setErrors(found)
    if (hasOrderErrors(found)) {
      const badLine = values.lines.find((l) => found.line[l.key])
      const id = found.customerId
        ? 'order-customerId'
        : found.orderDate
          ? 'order-orderDate'
          : badLine
            ? `line-${badLine.key}-${Object.keys(found.line[badLine.key])[0]}`
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

        <section
          aria-label="Products and services"
          className="rounded-lg border border-outline-variant bg-surface p-5 shadow-card"
        >
          <h2 className="text-title-md font-semibold text-on-surface">Products and services</h2>
          <p className="mt-0.5 text-label-md text-on-surface-variant">Prices exclude VAT.</p>
          {errors.lines && (
            <p role="alert" className="mt-3 text-label-md text-error">
              {errors.lines}
            </p>
          )}
          <ol className="mt-4 flex flex-col gap-4">
            {values.lines.map((l, i) => {
              const le = errors.line[l.key] ?? {}
              return (
                <li
                  key={l.key}
                  className="rounded-md border border-outline-variant p-4"
                  aria-label={`Line ${i + 1}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-label-md font-semibold text-on-surface-variant">
                      Line {i + 1}
                      {l.productId ? ' · catalogue product' : ''}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() =>
                        set(
                          'lines',
                          values.lines.filter((x) => x.key !== l.key),
                        )
                      }
                      className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container hover:text-error"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
                    <Input
                      id={`line-${l.key}-description`}
                      label="Description"
                      value={l.description}
                      onChange={(e) => setLine(l.key, { description: e.target.value })}
                      error={le.description}
                    />
                    <Input
                      id={`line-${l.key}-quantity`}
                      label="Quantity"
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                      error={le.quantity}
                    />
                    <Input
                      id={`line-${l.key}-unitPrice`}
                      label="Unit price (R)"
                      inputMode="decimal"
                      value={l.unitPrice}
                      onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                      error={le.unitPrice}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => addLine()}>
              <Plus size={16} aria-hidden="true" /> Add line
            </Button>
            <Button
              variant="secondary"
              aria-expanded={choosing}
              onClick={() => setChoosing((c) => !c)}
            >
              <PackagePlus size={16} aria-hidden="true" /> Add from catalogue
            </Button>
          </div>
          {choosing && (
            <div className="mt-4">
              <OptionPicker<ProductOption>
                id="order-product"
                label="Product"
                noun="products"
                placeholder="Search by name or SKU"
                selected={null}
                search={(text) => searchProducts(text)}
                title={(p) => p.name}
                detail={(p) => `${p.sku} · ${formatRand(p.unitPrice, { cents: true })}`}
                onSelect={chooseProduct}
              />
            </div>
          )}
        </section>

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
