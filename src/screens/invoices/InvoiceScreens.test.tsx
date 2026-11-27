import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as invoiceService from '@/services/invoices'
import * as messageService from '@/services/messages'
import * as shareService from '@/services/share'
import { shareReady } from '@/test/share'
import * as orderService from '@/services/orders'
import * as propertyService from '@/services/properties'
import * as activityService from '@/services/salesActivities'
import { invoiceFixture, orderFixture, supplierFixture } from '@/test/fixtures'
import type { UserRole } from '@/types/auth'
import { businessToday } from '@/utils/consumption'
import { err, ok } from '@/utils/result'

vi.mock('@/services/invoices')
vi.mock('@/services/orders')
vi.mock('@/services/properties')
vi.mock('@/services/salesActivities')
vi.mock('@/services/maintenance')
vi.mock('@/services/messages')
vi.mock('@/services/share', async (real) => ({
  ...(await real<typeof import('@/services/share')>()),
  ...(await import('@/test/share')).shareMocks(),
}))
const download = vi.hoisted(() => vi.fn())
const build = vi.hoisted(() => vi.fn())
vi.mock('@/utils/invoicePdf', () => ({ downloadInvoicePdf: download, buildInvoicePdf: build }))

const i = vi.mocked(invoiceService)
const o = vi.mocked(orderService)
const cleo = { id: 'c1', name: 'Cleo Client', companyName: null, email: 'client1@umbane.test' }
const payment = {
  id: 'p1',
  referenceNumber: 'PAY-00003',
  invoiceId: 'inv1',
  invoiceNumber: 'INV-2026-00007',
  customerId: 'c1',
  customerName: 'Cleo Client',
  amount: 100000,
  method: 'eft' as const,
  reference: 'FNB-884102',
  notes: null,
  paidOn: '2026-11-22',
  recordedByName: 'Sam Staff',
}

beforeEach(() => {
  vi.resetAllMocks()
  i.listInvoices.mockImplementation(() =>
    Promise.resolve(ok({ rows: [invoiceFixture()], total: 1 })),
  )
  i.getInvoiceSummary.mockResolvedValue(
    ok({
      drafts: 2,
      issued: 10,
      paid: 7,
      unpaid: 2,
      overdue: 1,
      outstanding: 512455,
      overdueAmount: 300,
    }),
  )
  i.getInvoice.mockImplementation(() => Promise.resolve(ok(invoiceFixture())))
  i.getInvoicePayments.mockResolvedValue(ok([payment]))
  i.getBillingProfile.mockResolvedValue(ok(supplierFixture()))
  i.listPayments.mockResolvedValue(ok({ rows: [payment], total: 1 }))
  vi.mocked(propertyService.getCustomerOption).mockResolvedValue(ok(cleo))
  vi.mocked(propertyService.searchCustomerOptions).mockResolvedValue(ok([cleo]))
  o.getCustomerPropertyOptions.mockResolvedValue(ok([]))
  o.searchProducts.mockResolvedValue(ok([]))
  o.getOrder.mockImplementation(() => Promise.resolve(ok(orderFixture({ status: 'confirmed' }))))
  vi.mocked(activityService.getTimeline).mockResolvedValue(ok([]))
  vi.mocked(activityService.getActivities).mockResolvedValue(ok([]))
})

const open = (route: string, role: UserRole = 'staff') => renderAt(<App />, signedInAs(role), route)

describe('invoice list', () => {
  it('shows totals and each invoice with its balance', async () => {
    open('/invoices')
    const row = (await screen.findByRole('link', { name: 'INV-2026-00007' })).closest('tr')!
    for (const text of [
      'Cleo Client',
      '20 Nov 2026',
      'R 312,455.00',
      'R 212,455.00',
      'Partially paid',
    ])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(await screen.findByText('R 512,455.00')).toBeInTheDocument()
    expect(screen.getByText('3 unpaid invoices')).toBeInTheDocument()
  })

  it('shows a draft without a balance', async () => {
    i.listInvoices.mockResolvedValue(
      ok({
        rows: [
          invoiceFixture({
            invoiceNumber: null,
            reference: 'Draft',
            status: 'draft',
            displayStatus: 'draft',
            issueDate: null,
            dueDate: null,
          }),
        ],
        total: 1,
      }),
    )
    open('/invoices')
    const row = (await screen.findByRole('link', { name: 'Draft' })).closest('tr')!
    expect(within(row).getAllByText('-')).toHaveLength(3)
  })

  it('filters by status through the URL, ignoring nonsense', async () => {
    open('/invoices?status=bogus')
    await screen.findByRole('link', { name: 'INV-2026-00007' })
    expect(i.listInvoices.mock.calls.at(-1)![1]).toMatchObject({ status: '' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'overdue')
    await waitFor(() =>
      expect(i.listInvoices.mock.calls.at(-1)![1]).toMatchObject({ status: 'overdue' }),
    )
  })

  it('links to settings for managers only', async () => {
    const staff = open('/invoices')
    await screen.findByRole('link', { name: 'INV-2026-00007' })
    expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull()
    staff.unmount()
    open('/invoices', 'manager')
    await screen.findByRole('link', { name: 'INV-2026-00007' })
    // The sidebar has its own Settings link; this one goes straight to invoicing.
    expect(
      screen.getAllByRole('link', { name: /Settings/ }).map((l) => l.getAttribute('href')),
    ).toContain('/settings/invoicing')
  })

  it('gives clients their own invoices, read-only, with a PDF', async () => {
    const list = open('/invoices', 'client')
    await screen.findByRole('link', { name: 'INV-2026-00007' })
    expect(screen.queryByRole('link', { name: /Create Invoice/ })).toBeNull()
    list.unmount()
    const detail = open('/invoices/inv1', 'client')
    expect(await screen.findByRole('button', { name: /Download PDF/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record Payment|Cancel/ })).toBeNull()
    expect(screen.queryByText('Sam Staff', { exact: false })).toBeNull()
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull()
    detail.unmount()
    open('/invoices/new', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })
})

describe('creating and editing', () => {
  it('saves a draft with VAT and terms from the settings', async () => {
    i.getBillingProfile.mockResolvedValue(ok(supplierFixture({ defaultPaymentTerms: 'net14' })))
    i.saveInvoice.mockResolvedValue(ok({ id: 'inv1' }))
    open('/invoices/new?customer=c1')
    await screen.findByText('Cleo Client')
    expect(screen.getByLabelText('Payment terms')).toHaveValue('net14')
    const line = screen.getByRole('listitem', { name: 'Line 1' })
    await userEvent.type(within(line).getByLabelText('Description'), 'Callout')
    await userEvent.type(within(line).getByLabelText('Unit price (R)'), '100')
    expect(
      within(screen.getByRole('region', { name: 'Invoice summary' })).getByText('R 115.00'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(await screen.findByText('Draft invoice saved.')).toBeInTheDocument()
    expect(i.saveInvoice.mock.calls[0]).toMatchObject([
      null,
      {
        customerId: 'c1',
        paymentTerms: 'net14',
        vatRate: 15,
        dueDate: null,
        items: [{ description: 'Callout', unitPrice: 100 }],
      },
    ])
  })

  it('offers no VAT to a business that is not registered', async () => {
    i.getBillingProfile.mockResolvedValue(ok(supplierFixture({ vatRegistered: false })))
    open('/invoices/new')
    const vat = await screen.findByLabelText('VAT')
    expect(vat).toHaveValue('0')
    expect(within(vat).getAllByRole('option')).toHaveLength(1)
  })

  it('refuses to edit an issued invoice', async () => {
    open('/invoices/inv1/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be changed')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('edits a draft from an order with the customer fixed', async () => {
    i.getInvoice.mockResolvedValue(
      ok(invoiceFixture({ status: 'draft', displayStatus: 'draft', invoiceNumber: null })),
    )
    i.saveInvoice.mockResolvedValue(ok({ id: 'inv1' }))
    open('/invoices/inv1/edit')
    expect(await screen.findByText(/from order ORD-00842/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem', { name: /^Line/ })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(i.saveInvoice.mock.calls[0][0]).toBe('inv1'))
    expect(i.saveInvoice.mock.calls[0][1]).toMatchObject({ orderId: 'o1', customerId: 'c1' })
  })

  it('creates a draft from a confirmed order', async () => {
    i.invoiceOrder.mockResolvedValue(ok({ id: 'inv1' }))
    open('/sales-orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: /Create Invoice/ }))
    expect(await screen.findByText(/Draft invoice created from the order/)).toBeInTheDocument()
    expect(i.invoiceOrder).toHaveBeenCalledWith('o1')
  })

  it('shows why an order cannot be invoiced again', async () => {
    i.invoiceOrder.mockResolvedValue(
      err({
        code: 'validation',
        message: 'This order already has an invoice. Open it from the invoice list.',
      }),
    )
    open('/sales-orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: /Create Invoice/ }))
    expect(await screen.findByText(/already has an invoice/)).toBeInTheDocument()
  })
})

describe('invoice details', () => {
  it('shows lines, totals, the balance and payments', async () => {
    open('/invoices/inv1')
    const lines = await screen.findByRole('table', { name: 'Invoice lines' })
    expect(within(lines).getByText('R 240,000.00')).toBeInTheDocument()
    expect(screen.getByText('R 212,455.00')).toBeInTheDocument()
    const payments = screen.getByRole('region', { name: 'Payments' })
    expect(
      await within(payments).findByText(/PAY-00003 · FNB-884102 · Sam Staff/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ORD-00842' })).toHaveAttribute(
      'href',
      '/sales-orders/o1',
    )
  })

  it('issues a draft after asking, with a chosen date', async () => {
    i.getInvoice.mockResolvedValue(
      ok(
        invoiceFixture({
          status: 'draft',
          displayStatus: 'draft',
          invoiceNumber: null,
          reference: 'Draft',
        }),
      ),
    )
    i.issueInvoice.mockResolvedValue(ok({ id: 'inv1' }))
    open('/invoices/inv1')
    expect(await screen.findByText(/This is a draft/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download PDF|Record Payment/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Issue Invoice/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Issue date')).toHaveValue(businessToday())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }))
    expect(await screen.findByText('Invoice issued and numbered.')).toBeInTheDocument()
    expect(i.issueInvoice).toHaveBeenCalledWith('inv1', businessToday())
  })

  it('records a payment, defaulting to the balance, and shows a refusal on its field', async () => {
    i.recordPayment.mockResolvedValueOnce(
      err({ code: 'validation', field: 'amount', message: 'This is more than the balance due.' }),
    )
    open('/invoices/inv1')
    await userEvent.click(await screen.findByRole('button', { name: /Record Payment/ }))
    const dialog = screen.getByRole('dialog')
    const amount = within(dialog).getByLabelText('Amount received (R)')
    expect(amount).toHaveValue('212455.00')
    await userEvent.clear(amount)
    await userEvent.type(amount, '212455.01')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    expect(within(dialog).getByText(/more than the balance of R 212,455.00/)).toBeInTheDocument()
    expect(i.recordPayment).not.toHaveBeenCalled()

    await userEvent.clear(amount)
    await userEvent.type(amount, '1000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    expect(
      await within(dialog).findByText('This is more than the balance due.'),
    ).toBeInTheDocument()

    i.recordPayment.mockResolvedValueOnce(ok({ id: 'p9' }))
    await userEvent.type(within(dialog).getByLabelText('Reference (optional)'), 'FNB-9')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText('Payment recorded.')).toBeInTheDocument()
    expect(i.recordPayment.mock.calls[1][0]).toMatchObject({
      invoiceId: 'inv1',
      amount: 1000,
      reference: 'FNB-9',
    })
  })

  it('lets only a manager remove a payment or cancel an issued invoice', async () => {
    const staff = open('/invoices/inv1')
    await screen.findByText(/PAY-00003/)
    expect(screen.queryByRole('button', { name: /Remove payment/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Cancel Invoice/ })).toBeNull()
    staff.unmount()

    i.removePayment.mockResolvedValue(ok(undefined))
    open('/invoices/inv1', 'manager')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove payment PAY-00003' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove payment' }),
    )
    expect(await screen.findByText('Payment removed.')).toBeInTheDocument()
    // With a payment on it, even a manager cannot cancel until the payment is gone.
    expect(screen.queryByRole('button', { name: /Cancel Invoice/ })).toBeNull()
  })

  it('cancels an unpaid issued invoice as a manager, with a reason', async () => {
    i.getInvoice.mockResolvedValue(
      ok(invoiceFixture({ status: 'sent', displayStatus: 'sent', paid: 0, balance: 312455 })),
    )
    i.cancelInvoice.mockResolvedValue(ok({ id: 'inv1' }))
    open('/invoices/inv1', 'manager')
    await userEvent.click(await screen.findByRole('button', { name: /Cancel Invoice/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Its number stays used')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong customer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }))
    expect(await screen.findByText('Invoice cancelled.')).toBeInTheDocument()
    expect(i.cancelInvoice).toHaveBeenCalledWith('inv1', 'Wrong customer')
  })

  it('downloads the PDF with the payments and supplier details', async () => {
    download.mockResolvedValue(undefined)
    open('/invoices/inv1')
    await screen.findByText(/PAY-00003/)
    await userEvent.click(screen.getByRole('button', { name: /Download PDF/ }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(download.mock.calls[0][0]).toMatchObject({
      invoice: { id: 'inv1' },
      payments: [{ id: 'p1' }],
      supplier: { vatNumber: '4180294512' },
    })
  })

  it('says so when the PDF cannot be made', async () => {
    download.mockRejectedValue(new Error('boom'))
    open('/invoices/inv1')
    await userEvent.click(await screen.findByRole('button', { name: /Download PDF/ }))
    expect(await screen.findByText(/PDF could not be made/)).toBeInTheDocument()
  })

  it('emails the invoice with its PDF attached', async () => {
    const m = vi.mocked(messageService)
    m.listTemplates.mockResolvedValue(
      ok([
        {
          id: 't1',
          key: 'invoice_issued',
          name: 'Invoice issued',
          purpose: 'transactional',
          subject: 'Invoice {{invoice_number}} from {{business_name}}',
          body: 'Good day {{customer_name}}, invoice {{invoice_number}} for {{invoice_total}}.',
          isActive: true,
          updatedAt: 'x',
        },
      ]),
    )
    m.getCustomerPreferences.mockResolvedValue(
      ok({
        email: 'client1@umbane.test',
        emailOptOut: false,
        marketingConsent: false,
        consentUpdatedAt: null,
        suppressedAt: null,
        suppressedReason: null,
      }),
    )
    m.getBusinessName.mockResolvedValue(ok('Umbane'))
    m.uploadEmailAttachment.mockResolvedValue(
      ok({ path: 'b1/k/INV-2026-00007.pdf', name: 'INV-2026-00007.pdf' }),
    )
    vi.mocked(shareService).listTeamRecipients.mockResolvedValue(ok([]))
    shareReady(vi.mocked(shareService))
    build.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    open('/invoices/inv1')
    await userEvent.click(await screen.findByRole('button', { name: /Share Invoice/ }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByLabelText('Email subject')).toHaveValue(
      'Invoice INV-2026-00007 from Umbane',
    )
    expect(within(dialog).getByLabelText(/Attach the invoice PDF/)).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText('Sent.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Sent to Email.')).toBeInTheDocument()
    expect(vi.mocked(shareService).queueMessage.mock.calls[0][0]).toMatchObject({
      channel: 'email',
      recipient: { kind: 'customer', id: 'c1' },
      invoiceId: 'inv1',
      templateKey: 'invoice_issued',
      attachment: { path: 'b1/k/INV-2026-00007.pdf', name: 'INV-2026-00007.pdf' },
    })
    expect(vi.mocked(shareService).sendMessages).toHaveBeenCalledWith(['msg1'])
  })
})

describe('payments and settings', () => {
  it('lists payments with links to their invoices', async () => {
    open('/invoices/payments')
    const row = (await screen.findByText('PAY-00003')).closest('tr')!
    expect(within(row).getByRole('link', { name: 'INV-2026-00007' })).toHaveAttribute(
      'href',
      '/invoices/inv1',
    )
    expect(within(row).getByText('EFT bank transfer')).toBeInTheDocument()
  })

  it('lets an administrator save the settings, checking the VAT number', async () => {
    i.updateBillingProfile.mockResolvedValue(ok(undefined))
    open('/settings/invoicing', 'administrator')
    const vat = await screen.findByLabelText('VAT number')
    await userEvent.clear(vat)
    await userEvent.type(vat, '123')
    await userEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    expect(screen.getByText(/starts with 4/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Not VAT registered'))
    await userEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    expect(i.updateBillingProfile.mock.calls[0]).toMatchObject(['b1', { vatRegistered: false }])
  })

  it('shows managers the settings read-only, and keeps staff out', async () => {
    const manager = open('/settings/invoicing', 'manager')
    expect(
      await screen.findByText('Only an administrator can change these details.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Settings' })).toBeNull()
    manager.unmount()
    open('/settings/invoicing')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })
})
