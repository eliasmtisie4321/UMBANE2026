export type StockStatus = 'in' | 'low' | 'out' | 'service'
export type MovementType = 'received' | 'sold' | 'adjusted' | 'returned'
/** What a person can record; sales come from fulfilled orders. */
export type ManualMovement = 'received' | 'adjusted' | 'returned'

export const STOCK_STATUSES: Array<{ value: StockStatus; label: string }> = [
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'service', label: 'Service (not stocked)' },
]

export const MOVEMENT_TYPES: Array<{ value: MovementType; label: string }> = [
  { value: 'received', label: 'Stock received' },
  { value: 'sold', label: 'Sold (order fulfilled)' },
  { value: 'adjusted', label: 'Adjustment' },
  { value: 'returned', label: 'Returned' },
]

export const MANUAL_MOVEMENTS: Array<{ value: ManualMovement; label: string; hint: string }> = [
  { value: 'received', label: 'Stock received', hint: 'A delivery from a supplier.' },
  { value: 'returned', label: 'Returned', hint: 'Units coming back from a customer.' },
  {
    value: 'adjusted',
    label: 'Adjustment',
    hint: 'A correction after a count, damage or loss. Can add or remove.',
  },
]

export interface ProductListItem {
  id: string
  sku: string
  name: string
  category: string | null
  unitPrice: number
  costPrice: number | null
  stockOnHand: number
  lowStockThreshold: number
  stockStatus: StockStatus
  stockValue: number | null
  isActive: boolean
  trackStock: boolean
}

export interface Product extends ProductListItem {
  description: string | null
  supplier: string | null
  createdAt: string
}

export type ProductSort = 'name' | 'sku' | 'stock_on_hand' | 'unit_price' | 'created_at'

export interface ProductInput {
  sku: string
  name: string
  category: string | null
  description: string | null
  unitPrice: number
  costPrice: number | null
  supplier: string | null
  lowStockThreshold: number
  trackStock: boolean
}

export interface InventorySummary {
  activeProducts: number
  units: number
  low: number
  outOfStock: number
  stockValue: number
  /** Products holding stock without a cost price, so missing from the value. */
  unvalued: number
}

export interface Movement {
  id: string
  reference: string
  productId: string
  sku: string
  productName: string
  type: MovementType
  quantity: number
  balanceBefore: number
  balanceAfter: number
  note: string | null
  orderId: string | null
  orderReference: string | null
  recordedByName: string | null
  createdAt: string
}

export interface MovementInput {
  productId: string
  type: ManualMovement
  /** Signed: negative only for an adjustment that removes stock. */
  quantity: number
  note: string | null
}

export interface ProductOrderLine {
  orderId: string
  reference: string
  customerName: string | null
  orderDate: string
  status: string
  quantity: number
}
