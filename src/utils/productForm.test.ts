import { describe, expect, it } from 'vitest'
import {
  emptyMovementForm,
  emptyProductForm,
  movementDelta,
  openingStockOf,
  parseUnits,
  toMovementInput,
  toProductInput,
  validateMovementForm,
  validateProductForm,
  type ProductFormValues,
} from './productForm'

const good: ProductFormValues = {
  ...emptyProductForm,
  sku: ' UMB-CT-400 ',
  name: ' Split-core CT set ',
  unitPrice: '4950',
  costPrice: '3420.50',
  openingStock: '12',
  lowStockThreshold: '5',
}

describe('product form', () => {
  it('accepts a complete product and converts it', () => {
    expect(validateProductForm(good, 'create')).toEqual({})
    expect(toProductInput(good)).toMatchObject({
      sku: 'UMB-CT-400',
      name: 'Split-core CT set',
      unitPrice: 4950,
      costPrice: 3420.5,
      lowStockThreshold: 5,
      category: null,
    })
    expect(openingStockOf(good)).toBe(12)
  })

  it('reports the required fields', () => {
    expect(Object.keys(validateProductForm(emptyProductForm, 'create')).sort()).toEqual([
      'name',
      'sku',
      'unitPrice',
    ])
  })

  it('refuses bad SKUs, prices and stock numbers', () => {
    const e = validateProductForm(
      { ...good, sku: 'CT 400!', unitPrice: '1,000', costPrice: '-1', openingStock: '2.5' },
      'create',
    )
    expect(Object.keys(e).sort()).toEqual(['costPrice', 'openingStock', 'sku', 'unitPrice'])
  })

  it('does not ask a service for stock, and never opens one with stock', () => {
    const service = { ...good, trackStock: false, openingStock: 'x', lowStockThreshold: 'x' }
    expect(validateProductForm(service, 'create')).toEqual({})
    expect(openingStockOf(service)).toBe(0)
    expect(toProductInput(service).lowStockThreshold).toBe(0)
  })

  it('does not ask for opening stock when editing', () => {
    expect(validateProductForm({ ...good, openingStock: '' }, 'edit')).toEqual({})
  })
})

describe('stock movements', () => {
  it('reads whole units only', () => {
    expect(parseUnits('1 000')).toBe(1000)
    for (const bad of ['', '-1', '1.5', '1,000', '1000001']) expect(parseUnits(bad)).toBeNull()
  })

  it('removes stock only for an adjustment marked remove', () => {
    const v = { ...emptyMovementForm, quantity: '5' }
    expect(movementDelta(v)).toBe(5)
    expect(movementDelta({ ...v, direction: 'remove' })).toBe(5)
    expect(movementDelta({ ...v, type: 'adjusted', direction: 'remove' })).toBe(-5)
    expect(movementDelta({ ...v, quantity: '0' })).toBeNull()
  })

  it('refuses going below zero and an adjustment without a reason', () => {
    const remove = { ...emptyMovementForm, type: 'adjusted' as const, direction: 'remove' as const }
    expect(validateMovementForm({ ...remove, quantity: '5', note: 'Count' }, 4).quantity).toMatch(
      /Only 4 on hand/,
    )
    expect(validateMovementForm({ ...remove, quantity: '4', note: '' }, 4).note).toBeTruthy()
    expect(validateMovementForm({ ...remove, quantity: '4', note: 'Damaged' }, 4)).toEqual({})
  })

  it('converts for saving', () => {
    expect(
      toMovementInput('p1', { ...emptyMovementForm, quantity: '3', note: ' PO-119 ' }),
    ).toEqual({ productId: 'p1', type: 'received', quantity: 3, note: 'PO-119' })
  })
})
