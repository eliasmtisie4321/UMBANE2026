import { useState, type FormEvent } from 'react'
import { FormError } from '@/components/data/ListPanel'
import { OptionPicker } from '@/components/data/OptionPicker'
import { Button, Input, Modal, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { recordMovement } from '@/services/inventory'
import { searchProducts } from '@/services/orders'
import { MANUAL_MOVEMENTS, type ManualMovement } from '@/types/inventory'
import type { ProductOption } from '@/types/sales'
import {
  emptyMovementForm,
  movementDelta,
  toMovementInput,
  validateMovementForm,
  type MovementFormErrors,
  type MovementFormValues,
} from '@/utils/productForm'

interface StockMovementDialogProps {
  /** The product, when it is already known; otherwise one is chosen in the dialog. */
  product: ProductOption | null
  onClose: () => void
  onSaved: (balanceAfter: number, product: ProductOption) => void
}

const units = (n: number) => `${n.toLocaleString('en-US')} ${Math.abs(n) === 1 ? 'unit' : 'units'}`

/** Receive, return or adjust stock. Mount it to open it. */
export function StockMovementDialog({ product, onClose, onSaved }: StockMovementDialogProps) {
  const [chosen, setChosen] = useState<ProductOption | null>(product)
  const [values, setValues] = useState<MovementFormValues>(emptyMovementForm)
  const [errors, setErrors] = useState<MovementFormErrors & { product?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof MovementFormValues>(key: K, value: MovementFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }
  const onHand = chosen?.stockOnHand ?? 0
  const delta = movementDelta(values)
  const kind = MANUAL_MOVEMENTS.find((m) => m.value === values.type)!

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: typeof errors = chosen ? validateMovementForm(values, onHand) : {}
    if (!chosen) found.product = 'Choose the product.'
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length > 0 || !chosen) return
    setSaving(true)
    const result = await recordMovement(toMovementInput(chosen.id, values))
    setSaving(false)
    if (result.ok) onSaved(result.data.balanceAfter, chosen)
    else if (result.error.field === 'quantity')
      setErrors((x) => ({ ...x, quantity: result.error.message }))
    else setServerError(result.error.message)
  }

  return (
    <Modal open title="Record stock movement" onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && <FormError>{serverError}</FormError>}
        {product ? (
          <p className="text-body-md text-on-surface-variant">
            <strong className="text-on-surface">{product.name}</strong> · {product.sku} ·{' '}
            {units(product.stockOnHand ?? 0)} on hand
          </p>
        ) : (
          <OptionPicker<ProductOption>
            id="move-product"
            label="Product"
            noun="products"
            placeholder="Search by name or SKU"
            selected={chosen}
            error={errors.product}
            // Services have no stock to move.
            search={async (text) => {
              const r = await searchProducts(text)
              return r.ok ? { ...r, data: r.data.filter((p) => p.trackStock) } : r
            }}
            title={(p) => p.name}
            detail={(p) => `${p.sku} · ${units(p.stockOnHand ?? 0)} on hand`}
            onSelect={(p) => {
              setChosen(p)
              setErrors((x) => ({ ...x, product: undefined, quantity: undefined }))
            }}
          />
        )}
        <RadioGroup
          legend="Type of movement"
          value={values.type}
          options={MANUAL_MOVEMENTS}
          onChange={(v: ManualMovement) => set('type', v)}
        />
        <p className="-mt-2 text-label-md text-on-surface-variant">{kind.hint}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {values.type === 'adjusted' && (
            <RadioGroup
              legend="Direction"
              value={values.direction}
              options={[
                { value: 'add', label: 'Add' },
                { value: 'remove', label: 'Remove' },
              ]}
              onChange={(v) => set('direction', v)}
            />
          )}
          <Input
            id="move-quantity"
            label="Units"
            inputMode="numeric"
            value={values.quantity}
            onChange={(e) => set('quantity', e.target.value)}
            error={errors.quantity}
          />
        </div>
        <Textarea
          id="move-note"
          label={values.type === 'adjusted' ? 'Reason' : 'Note or reference (optional)'}
          rows={2}
          placeholder={values.type === 'received' ? 'e.g. PO-2026-119' : undefined}
          value={values.note}
          onChange={(e) => set('note', e.target.value)}
          error={errors.note}
        />
        {chosen && delta !== null && onHand + delta >= 0 && (
          <p role="status" className="text-body-md text-on-surface">
            {units(onHand)} on hand becomes <strong>{units(onHand + delta)}</strong>.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save movement
          </Button>
        </div>
      </form>
    </Modal>
  )
}
