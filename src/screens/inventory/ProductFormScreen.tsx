import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { useResource } from '@/hooks/useResource'
import { createProduct, getCategories, getProduct, updateProduct } from '@/services/inventory'
import type { AppError } from '@/types/api'
import {
  emptyProductForm,
  openingStockOf,
  productToForm,
  toProductInput,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormValues,
} from '@/utils/productForm'

const FIELD_ORDER: Array<keyof ProductFormValues> = [
  'name',
  'sku',
  'category',
  'supplier',
  'description',
  'costPrice',
  'unitPrice',
  'openingStock',
  'lowStockThreshold',
]

interface ProductFormProps {
  initial: ProductFormValues
  mode: 'create' | 'edit'
  /** Units on hand, when editing: stock tracking cannot be switched off while any are held. */
  onHand?: number
  submitting: boolean
  serverError: AppError | null
  cancelTo: string
  onSubmit: (values: ProductFormValues) => void
}

function ProductForm({
  initial,
  mode,
  onHand = 0,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: ProductFormProps) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<ProductFormErrors>({})
  const categories = useResource(() => getCategories(), 'categories')
  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const fieldError = (k: keyof ProductFormValues) =>
    errors[k] ?? (serverError?.field === k ? serverError.message : undefined)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateProductForm(values, mode)
    setErrors(found)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) return document.getElementById(`product-${first}`)?.focus()
    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-4xl flex-col gap-5">
      {serverError && !serverError.field && <FormError>{serverError.message}</FormError>}
      <FormSection title="Product information">
        <Input
          id="product-name"
          label="Product name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={fieldError('name')}
        />
        <Input
          id="product-sku"
          label="SKU"
          placeholder="e.g. UMB-CT-400"
          value={values.sku}
          onChange={(e) => set('sku', e.target.value)}
          error={fieldError('sku')}
        />
        <Input
          id="product-category"
          label="Category (optional)"
          list="product-categories"
          placeholder="e.g. Smart Prepaid Meters"
          value={values.category}
          onChange={(e) => set('category', e.target.value)}
          error={fieldError('category')}
        />
        <datalist id="product-categories">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Input
          id="product-supplier"
          label="Supplier (optional)"
          value={values.supplier}
          onChange={(e) => set('supplier', e.target.value)}
          error={fieldError('supplier')}
        />
        <div className="sm:col-span-2">
          <Textarea
            id="product-description"
            label="Description (optional)"
            rows={3}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            error={fieldError('description')}
          />
        </div>
      </FormSection>
      <FormSection title="Prices" description="Excluding VAT.">
        <Input
          id="product-costPrice"
          label="Cost price (R, optional)"
          inputMode="decimal"
          hint="What you pay. Used for the stock value."
          value={values.costPrice}
          onChange={(e) => set('costPrice', e.target.value)}
          error={fieldError('costPrice')}
        />
        <Input
          id="product-unitPrice"
          label="Selling price (R)"
          inputMode="decimal"
          value={values.unitPrice}
          onChange={(e) => set('unitPrice', e.target.value)}
          error={fieldError('unitPrice')}
        />
      </FormSection>
      <FormSection title="Stock">
        <div className="sm:col-span-2">
          <RadioGroup
            legend="Is this stocked?"
            value={values.trackStock ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: 'Stocked product' },
              { value: 'no', label: 'Service (no stock)' },
            ]}
            onChange={(v) => set('trackStock', v === 'yes')}
          />
          {fieldError('trackStock') && (
            <p role="alert" className="mt-1 text-label-sm text-error">
              {fieldError('trackStock')}
            </p>
          )}
          {mode === 'edit' && values.trackStock !== initial.trackStock && onHand > 0 && (
            <p className="mt-1 text-label-md text-on-surface-variant">
              {onHand.toLocaleString('en-US')} units are on hand. Adjust them to zero first.
            </p>
          )}
        </div>
        {values.trackStock && mode === 'create' && (
          <Input
            id="product-openingStock"
            label="Opening stock (units)"
            inputMode="numeric"
            hint="Recorded as stock received."
            value={values.openingStock}
            onChange={(e) => set('openingStock', e.target.value)}
            error={fieldError('openingStock')}
          />
        )}
        {values.trackStock && (
          <Input
            id="product-lowStockThreshold"
            label="Minimum stock level (units)"
            inputMode="numeric"
            hint="At or below this, it shows as low stock."
            value={values.lowStockThreshold}
            onChange={(e) => set('lowStockThreshold', e.target.value)}
            error={fieldError('lowStockThreshold')}
          />
        )}
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Link to={cancelTo} className={secondaryLink}>
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Save Product' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

export function NewProductScreen() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  return (
    <>
      <PageHeader
        title="Add Product"
        subtitle="A product or service you sell."
        back={{ to: '/inventory', label: 'Inventory' }}
      />
      <ProductForm
        initial={emptyProductForm}
        mode="create"
        submitting={submitting}
        serverError={error}
        cancelTo="/inventory"
        onSubmit={async (values) => {
          setSubmitting(true)
          setError(null)
          const result = await createProduct(toProductInput(values), openingStockOf(values))
          setSubmitting(false)
          if (result.ok)
            navigate(`/inventory/${result.data.id}`, { state: { notice: 'Product added.' } })
          else setError(result.error)
        }}
      />
    </>
  )
}

export function EditProductScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(() => getProduct(id), `product-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  return (
    <>
      <PageHeader
        title="Edit Product"
        subtitle={state.data?.name}
        back={{ to: `/inventory/${id}`, label: 'Product details' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(product) => (
          <ProductForm
            key={product.id}
            initial={productToForm(product)}
            mode="edit"
            onHand={product.stockOnHand}
            submitting={submitting}
            serverError={error}
            cancelTo={`/inventory/${id}`}
            onSubmit={async (values) => {
              setSubmitting(true)
              setError(null)
              const result = await updateProduct(id, toProductInput(values))
              setSubmitting(false)
              if (result.ok) navigate(`/inventory/${id}`, { state: { notice: 'Product updated.' } })
              else setError(result.error)
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
