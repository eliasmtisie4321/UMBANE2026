import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as inventoryService from '@/services/inventory'
import * as orderService from '@/services/orders'
import type { UserRole } from '@/types/auth'
import type { Movement, Product } from '@/types/inventory'
import { err, ok } from '@/utils/result'

vi.mock('@/services/inventory')
vi.mock('@/services/orders')

const s = vi.mocked(inventoryService)
const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  sku: 'UMB-CT-400',
  name: 'Split-core CT set',
  category: 'Commercial CT',
  description: null,
  unitPrice: 4950,
  costPrice: 3420,
  supplier: 'Actom',
  stockOnHand: 6,
  lowStockThreshold: 6,
  stockStatus: 'low',
  stockValue: 20520,
  isActive: true,
  trackStock: true,
  createdAt: '2026-11-01T08:00:00Z',
  ...over,
})
const movement = (over: Partial<Movement> = {}): Movement => ({
  id: 'm1',
  reference: 'MOV-00012',
  productId: 'p1',
  sku: 'UMB-CT-400',
  productName: 'Split-core CT set',
  type: 'sold',
  quantity: -24,
  balanceBefore: 30,
  balanceAfter: 6,
  note: 'Order ORD-00842',
  orderId: 'o1',
  orderReference: 'ORD-00842',
  recordedByName: 'Sam Staff',
  createdAt: '2026-11-22T08:05:00Z',
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  s.listProducts.mockImplementation(() => Promise.resolve(ok({ rows: [product()], total: 1 })))
  s.getInventorySummary.mockResolvedValue(
    ok({
      activeProducts: 148,
      units: 4290,
      low: 14,
      outOfStock: 4,
      stockValue: 8460000,
      unvalued: 2,
    }),
  )
  s.getStockAlerts.mockResolvedValue(ok([product()]))
  s.getCategories.mockResolvedValue(ok(['Commercial CT', 'Smart Prepaid']))
  s.getProduct.mockImplementation(() => Promise.resolve(ok(product())))
  s.listMovements.mockResolvedValue(ok({ rows: [movement()], total: 1 }))
  s.getProductOrders.mockResolvedValue(ok([]))
  vi.mocked(orderService.searchProducts).mockResolvedValue(
    ok([
      {
        id: 'p1',
        sku: 'UMB-CT-400',
        name: 'Split-core CT set',
        unitPrice: 4950,
        trackStock: true,
        stockOnHand: 6,
      },
      {
        id: 's1',
        sku: 'SRV-1',
        name: 'Installation',
        unitPrice: 1500,
        trackStock: false,
        stockOnHand: 0,
      },
    ]),
  )
})

const open = (route: string, role: UserRole = 'staff') => renderAt(<App />, signedInAs(role), route)

describe('inventory', () => {
  it('shows totals, alerts and products', async () => {
    open('/inventory')
    const list = await screen.findByRole('table', { name: 'Products' })
    const row = within(list).getByRole('link', { name: 'Split-core CT set' }).closest('tr')!
    for (const text of [
      'UMB-CT-400',
      'Commercial CT',
      'R 3,420.00',
      'R 4,950.00',
      '6',
      'Low stock',
    ])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(await screen.findByText('R 8,460,000.00')).toBeInTheDocument()
    expect(screen.getByText('2 products have no cost price')).toBeInTheDocument()
    const alerts = screen.getByRole('region', { name: 'Low stock alerts' })
    expect(within(alerts).getByText(/6 left, minimum 6/)).toBeInTheDocument()
  })

  it('filters by stock level and shows inactive products only when asked', async () => {
    open('/inventory?stock=nonsense')
    await screen.findByRole('table', { name: 'Products' })
    expect(s.listProducts.mock.calls.at(-1)![1]).toEqual({
      status: '',
      category: '',
      includeInactive: false,
    })
    await userEvent.selectOptions(screen.getByLabelText('Stock'), 'out')
    await userEvent.click(screen.getByLabelText('Show inactive'))
    await waitFor(() =>
      expect(s.listProducts.mock.calls.at(-1)![1]).toEqual({
        status: 'out',
        category: '',
        includeInactive: true,
      }),
    )
  })

  it('is closed to clients', async () => {
    for (const route of ['/inventory', '/inventory/p1', '/inventory/history']) {
      const view = open(route, 'client')
      expect(
        await screen.findByRole('heading', { name: /do not have access/i }),
      ).toBeInTheDocument()
      view.unmount()
    }
    expect(s.listProducts).not.toHaveBeenCalled()
  })
})

describe('stock movements', () => {
  it('receives stock for a chosen product, offering only stocked ones', async () => {
    s.recordMovement.mockResolvedValue(ok({ id: 'm9', balanceAfter: 16 }))
    open('/inventory')
    await userEvent.click(await screen.findByRole('button', { name: /Stock Movement/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('button', { name: /Split-core CT set/ })
    expect(within(dialog).queryByRole('button', { name: /Installation/ })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: /Split-core CT set/ }))
    await userEvent.type(within(dialog).getByLabelText('Units'), '10')
    expect(within(dialog).getByRole('status')).toHaveTextContent('6 units on hand becomes 16 units')
    await userEvent.type(within(dialog).getByLabelText(/Note or reference/), 'PO-119')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save movement' }))
    expect(await screen.findByText('Split-core CT set: 16 now on hand.')).toBeInTheDocument()
    expect(s.recordMovement).toHaveBeenCalledWith({
      productId: 'p1',
      type: 'received',
      quantity: 10,
      note: 'PO-119',
    })
  })

  it('needs a reason to adjust, and refuses going below zero', async () => {
    open('/inventory/p1')
    await userEvent.click(await screen.findByRole('button', { name: /Adjust Stock/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Adjustment'))
    await userEvent.click(within(dialog).getByLabelText('Remove'))
    await userEvent.type(within(dialog).getByLabelText('Units'), '7')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save movement' }))
    expect(within(dialog).getByText(/Only 6 on hand/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Say why/)).toBeInTheDocument()
    expect(s.recordMovement).not.toHaveBeenCalled()
  })

  it('shows the database refusing for lack of stock on the units field', async () => {
    s.recordMovement.mockResolvedValue(
      err({
        code: 'validation',
        field: 'quantity',
        message: 'There is not enough stock for this. Receive stock first, then try again.',
      }),
    )
    open('/inventory/p1')
    await userEvent.click(await screen.findByRole('button', { name: /Adjust Stock/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Adjustment'))
    await userEvent.click(within(dialog).getByLabelText('Remove'))
    await userEvent.type(within(dialog).getByLabelText('Units'), '6')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Damaged in transit')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save movement' }))
    expect(await within(dialog).findByText(/not enough stock/)).toBeInTheDocument()
    expect(s.recordMovement).toHaveBeenCalledWith({
      productId: 'p1',
      type: 'adjusted',
      quantity: -6,
      note: 'Damaged in transit',
    })
  })
})

describe('products', () => {
  it('shows stock, prices, margin and history with before and after', async () => {
    open('/inventory/p1')
    // On hand and the minimum are both 6 in this fixture.
    expect(await screen.findAllByText('6 units')).toHaveLength(2)
    expect(screen.getByText('30.9%')).toBeInTheDocument()
    const history = screen.getByRole('region', { name: 'Stock movement history' })
    const row = (await within(history).findByText('-24')).closest('tr')!
    expect(within(row).getByText('30')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'ORD-00842' })).toHaveAttribute(
      'href',
      '/sales-orders/o1',
    )
    expect(s.listMovements.mock.calls[0][1]).toMatchObject({ productId: 'p1' })
  })

  it('explains a service and offers no stock actions', async () => {
    s.getProduct.mockResolvedValue(ok(product({ trackStock: false, stockStatus: 'service' })))
    open('/inventory/p1')
    expect(await screen.findByText(/This is a service/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Adjust Stock/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Stock movement history' })).toBeNull()
  })

  it('deactivates instead of deleting', async () => {
    s.setProductActive.mockResolvedValue(ok({ id: 'p1' }))
    open('/inventory/p1')
    await userEvent.click(await screen.findByRole('button', { name: /Deactivate/ }))
    expect(await screen.findByText(/Product deactivated/)).toBeInTheDocument()
    expect(s.setProductActive).toHaveBeenCalledWith('p1', false)
  })

  it('adds a product with opening stock, and shows a duplicate SKU on its field', async () => {
    s.createProduct.mockResolvedValueOnce(
      err({ code: 'conflict', field: 'sku', message: 'A product with this SKU already exists.' }),
    )
    open('/inventory/new')
    await userEvent.type(await screen.findByLabelText('Product name'), 'Prepaid meter')
    await userEvent.type(screen.getByLabelText('SKU'), 'MTR-1')
    await userEvent.type(screen.getByLabelText('Selling price (R)'), '850')
    const opening = screen.getByLabelText('Opening stock (units)')
    await userEvent.clear(opening)
    await userEvent.type(opening, '20')
    await userEvent.click(screen.getByRole('button', { name: 'Save Product' }))
    expect(await screen.findByText('A product with this SKU already exists.')).toBeInTheDocument()

    s.createProduct.mockResolvedValueOnce(ok({ id: 'p1' }))
    await userEvent.type(screen.getByLabelText('SKU'), 'B')
    await userEvent.click(screen.getByRole('button', { name: 'Save Product' }))
    expect(await screen.findByText('Product added.')).toBeInTheDocument()
    expect(s.createProduct.mock.calls[1]).toMatchObject([
      { sku: 'MTR-1B', unitPrice: 850, trackStock: true },
      20,
    ])
  })

  it('does not ask a service for stock', async () => {
    s.createProduct.mockResolvedValue(ok({ id: 's1' }))
    open('/inventory/new')
    await userEvent.click(await screen.findByLabelText('Service (no stock)'))
    expect(screen.queryByLabelText('Opening stock (units)')).toBeNull()
    expect(screen.queryByLabelText(/Minimum stock level/)).toBeNull()
  })

  it('warns before switching a stocked product with units to a service', async () => {
    open('/inventory/p1/edit')
    await userEvent.click(await screen.findByLabelText('Service (no stock)'))
    expect(screen.getByText('6 units are on hand. Adjust them to zero first.')).toBeInTheDocument()
  })
})

describe('history', () => {
  it('lists every movement with filters', async () => {
    open('/inventory/history?type=bogus')
    expect(await screen.findByRole('link', { name: 'Split-core CT set' })).toBeInTheDocument()
    expect(s.listMovements.mock.calls.at(-1)![1]).toMatchObject({ type: '', productId: '' })
    await userEvent.selectOptions(screen.getByLabelText('Movement'), 'adjusted')
    await waitFor(() =>
      expect(s.listMovements.mock.calls.at(-1)![1]).toMatchObject({ type: 'adjusted' }),
    )
  })
})
