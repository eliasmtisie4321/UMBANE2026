import type { ManualMovement, MovementInput, Product, ProductInput } from '@/types/inventory'
import { centsToRand, parseCents } from './orderMath'

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())
const MAX_UNIT_CENTS = 999_999_999n
const AMOUNT_HELP = 'Enter an amount in rand, e.g. 1500.50 (no commas).'

/** A whole number of units, 0 to 1,000,000; null otherwise. */
export function parseUnits(input: string): number | null {
  const s = input.replace(/\s/g, '')
  return /^\d{1,7}$/.test(s) && Number(s) <= 1_000_000 ? Number(s) : null
}

export interface ProductFormValues {
  sku: string
  name: string
  category: string
  description: string
  unitPrice: string
  costPrice: string
  supplier: string
  lowStockThreshold: string
  openingStock: string
  trackStock: boolean
}
export type ProductFormErrors = Partial<Record<keyof ProductFormValues, string>>

export const emptyProductForm: ProductFormValues = {
  sku: '',
  name: '',
  category: '',
  description: '',
  unitPrice: '',
  costPrice: '',
  supplier: '',
  lowStockThreshold: '0',
  openingStock: '0',
  trackStock: true,
}

export function validateProductForm(
  v: ProductFormValues,
  mode: 'create' | 'edit',
): ProductFormErrors {
  const e: ProductFormErrors = {}
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/.test(v.sku.trim()))
    e.sku = 'Use 2 to 40 letters, numbers, dots, dashes or slashes, e.g. UMB-CT-400.'
  if (v.name.trim().length < 2) e.name = 'Enter the product name.'
  else if (v.name.length > 160) e.name = 'Keep the name under 160 characters.'
  const price = parseCents(v.unitPrice)
  if (price === null || price > MAX_UNIT_CENTS) e.unitPrice = AMOUNT_HELP
  if (v.costPrice.trim()) {
    const cost = parseCents(v.costPrice)
    if (cost === null || cost > MAX_UNIT_CENTS) e.costPrice = AMOUNT_HELP
  }
  if (v.trackStock && parseUnits(v.lowStockThreshold) === null)
    e.lowStockThreshold = 'Enter a whole number of units, 0 or more.'
  if (mode === 'create' && v.trackStock && parseUnits(v.openingStock) === null)
    e.openingStock = 'Enter a whole number of units, 0 or more.'
  if (v.category.length > 60) e.category = 'Keep the category under 60 characters.'
  if (v.supplier.length > 120) e.supplier = 'Keep the supplier under 120 characters.'
  if (v.description.length > 2000) e.description = 'Keep the description under 2,000 characters.'
  return e
}

export const toProductInput = (v: ProductFormValues): ProductInput => ({
  sku: v.sku.trim(),
  name: v.name.trim(),
  category: orNull(v.category),
  description: orNull(v.description),
  unitPrice: centsToRand(parseCents(v.unitPrice) ?? 0n),
  costPrice: v.costPrice.trim() ? centsToRand(parseCents(v.costPrice) ?? 0n) : null,
  supplier: orNull(v.supplier),
  lowStockThreshold: v.trackStock ? (parseUnits(v.lowStockThreshold) ?? 0) : 0,
  trackStock: v.trackStock,
})

export const openingStockOf = (v: ProductFormValues): number =>
  v.trackStock ? (parseUnits(v.openingStock) ?? 0) : 0

export const productToForm = (p: Product): ProductFormValues => ({
  sku: p.sku,
  name: p.name,
  category: p.category ?? '',
  description: p.description ?? '',
  unitPrice: p.unitPrice.toFixed(2),
  costPrice: p.costPrice === null ? '' : p.costPrice.toFixed(2),
  supplier: p.supplier ?? '',
  lowStockThreshold: String(p.lowStockThreshold),
  openingStock: '0',
  trackStock: p.trackStock,
})

// Stock movement ---------------------------------------------------------------------------------
export interface MovementFormValues {
  type: ManualMovement
  /** For an adjustment: add or remove. */
  direction: 'add' | 'remove'
  quantity: string
  note: string
}
export type MovementFormErrors = Partial<Record<keyof MovementFormValues, string>>

export const emptyMovementForm: MovementFormValues = {
  type: 'received',
  direction: 'add',
  quantity: '',
  note: '',
}

/** The signed change this form describes. */
export const movementDelta = (v: MovementFormValues): number | null => {
  const n = parseUnits(v.quantity)
  if (n === null || n === 0) return null
  return v.type === 'adjusted' && v.direction === 'remove' ? -n : n
}

export function validateMovementForm(v: MovementFormValues, onHand: number): MovementFormErrors {
  const e: MovementFormErrors = {}
  const delta = movementDelta(v)
  if (delta === null) e.quantity = 'Enter a whole number of units, 1 or more.'
  else if (onHand + delta < 0)
    e.quantity = `Only ${onHand.toLocaleString('en-US')} on hand, so this would go below zero.`
  if (v.type === 'adjusted' && v.note.trim().length < 3)
    e.note = 'Say why: the count, damage or loss.'
  else if (v.note.length > 500) e.note = 'Keep the note under 500 characters.'
  return e
}

export const toMovementInput = (productId: string, v: MovementFormValues): MovementInput => ({
  productId,
  type: v.type,
  quantity: movementDelta(v) ?? 0,
  note: orNull(v.note),
})
