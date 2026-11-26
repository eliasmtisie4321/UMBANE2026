import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { OptionPicker } from '@/components/data/OptionPicker'
import { Button, Input } from '@/components/ui'
import { searchProducts } from '@/services/orders'
import type { ProductOption } from '@/types/sales'
import { formatRand } from '@/utils/format'
import { blankLine, type LineErrors, type OrderLine } from '@/utils/salesForm'

interface LineItemsEditorProps {
  lines: OrderLine[]
  errors: LineErrors
  onChange: (lines: OrderLine[]) => void
  /** A line's field was edited, so its error can go. Null: lines were added or removed. */
  onEdited: (key: number | null, fields: string[]) => void
}

/** Products and services on an order or invoice: typed lines, or picked from the catalogue. */
export function LineItemsEditor({ lines, errors, onChange, onEdited }: LineItemsEditorProps) {
  const [choosing, setChoosing] = useState(false)
  const nextKey = useRef(Math.max(0, ...lines.map((l) => l.key)) + 1)

  const setLine = (key: number, patch: Partial<OrderLine>) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    onEdited(key, Object.keys(patch))
  }
  const addLine = (line: Partial<OrderLine> = {}) => {
    onChange([...lines, { ...blankLine(nextKey.current++), ...line }])
    onEdited(null, [])
  }
  function chooseProduct(p: ProductOption | null) {
    if (!p) return
    const line = { productId: p.id, description: p.name, unitPrice: p.unitPrice.toFixed(2) }
    // The first, still blank line is filled in rather than left behind.
    const blank = lines.find((l) => !l.productId && !l.description && !l.unitPrice)
    if (blank) setLine(blank.key, line)
    else addLine(line)
    setChoosing(false)
  }

  return (
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
        {lines.map((l, i) => {
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
                  onClick={() => {
                    onChange(lines.filter((x) => x.key !== l.key))
                    onEdited(null, [])
                  }}
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
        <Button variant="secondary" aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>
          <PackagePlus size={16} aria-hidden="true" /> Add from catalogue
        </Button>
      </div>
      {choosing && (
        <div className="mt-4">
          <OptionPicker<ProductOption>
            id="line-product"
            label="Product"
            noun="products"
            placeholder="Search by name or SKU"
            selected={null}
            search={(text) => searchProducts(text)}
            title={(p) => p.name}
            detail={(p) =>
              [
                p.sku,
                formatRand(p.unitPrice, { cents: true }),
                p.trackStock ? `${p.stockOnHand.toLocaleString('en-US')} in stock` : 'service',
              ].join(' · ')
            }
            onSelect={chooseProduct}
          />
        </div>
      )}
    </section>
  )
}
