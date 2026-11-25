import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as svc from '@/services/customers'
import { customerRow } from '@/test/fixtures'
import { err, ok } from '@/utils/result'

vi.mock('@/services/customers', () => ({
  listCustomers: vi.fn(),
  setCustomerStatus: vi.fn(),
  getCustomer: vi.fn(),
  getCustomerProperties: vi.fn(),
  getCustomerInvoices: vi.fn(),
  getCustomerOrders: vi.fn(),
  getCustomerTickets: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}))

const s = vi.mocked(svc)
const list = s.listCustomers

const page = (rows = [customerRow()], total = rows.length) => ok({ rows, total })

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue(
    page(
      [
        customerRow(),
        customerRow({
          id: 'c2',
          name: 'Kagiso Logistics',
          companyName: 'Kagiso Logistics (Pty) Ltd',
          customerType: 'business',
          segment: 'commercial',
          phone: null,
          email: null,
          status: 'pending',
          propertyCount: 0,
        }),
      ],
      2,
    ),
  )
})

const open = (route = '/customers') => renderAt(<App />, signedInAs('staff'), route)
const lastQuery = () => list.mock.calls.at(-1)!

describe('customer list', () => {
  it('shows each customer with formatted phone, segment, property count and status', async () => {
    open()
    const row = (await screen.findByRole('link', { name: 'Cleo Client' })).closest('tr')!
    expect(within(row).getByText('+27 82 441 9082')).toBeInTheDocument()
    expect(within(row).getByText('Residential')).toBeInTheDocument()
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    const business = screen.getByRole('link', { name: 'Kagiso Logistics' }).closest('tr')!
    expect(within(business).getByText('Kagiso Logistics (Pty) Ltd')).toBeInTheDocument()
    expect(within(business).getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('2 customers')).toBeInTheDocument()
  })

  it('starts sorted by name with the default page size', async () => {
    open()
    await screen.findByRole('link', { name: 'Cleo Client' })
    expect(lastQuery()[0]).toEqual({
      search: '',
      sort: 'name',
      ascending: true,
      page: 1,
      pageSize: 25,
    })
    expect(screen.getByRole('columnheader', { name: /Customer/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(screen.getByRole('columnheader', { name: /Added/ })).toHaveAttribute('aria-sort', 'none')
  })

  it('searches after typing stops, and keeps the text in the box', async () => {
    open()
    await screen.findByRole('link', { name: 'Cleo Client' })
    await userEvent.type(screen.getByLabelText('Search customers'), 'cleo')
    await waitFor(() => expect(lastQuery()[0]).toMatchObject({ search: 'cleo', page: 1 }), {
      timeout: 3000,
    })
    expect(screen.getByLabelText('Search customers')).toHaveValue('cleo')
  })

  it('filters by status and customer type', async () => {
    open()
    await screen.findByRole('link', { name: 'Cleo Client' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'pending')
    await waitFor(() => expect(lastQuery()[1]).toEqual({ status: 'pending', segment: '' }))
    await userEvent.selectOptions(screen.getByLabelText('Customer type'), 'commercial')
    await waitFor(() =>
      expect(lastQuery()[1]).toEqual({ status: 'pending', segment: 'commercial' }),
    )
  })

  it('reads filters, sort and page from the URL, ignoring unknown values', async () => {
    open('/customers?status=inactive&segment=nonsense&sort=password&dir=desc&page=2')
    await screen.findByRole('link', { name: 'Cleo Client' })
    expect(lastQuery()[0]).toMatchObject({ sort: 'name', ascending: true, page: 2 })
    expect(lastQuery()[1]).toEqual({ status: 'inactive', segment: '' })
  })

  it('sorts by a column and flips direction on a second click', async () => {
    open()
    await screen.findByRole('link', { name: 'Cleo Client' })
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: /Added/ })).getByRole('button'),
    )
    await waitFor(() =>
      expect(lastQuery()[0]).toMatchObject({ sort: 'created_at', ascending: true }),
    )
    await userEvent.click(
      within(screen.getByRole('columnheader', { name: /Added/ })).getByRole('button'),
    )
    await waitFor(() =>
      expect(lastQuery()[0]).toMatchObject({ sort: 'created_at', ascending: false }),
    )
    expect(screen.getByRole('columnheader', { name: /Added/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('paginates and shows the range', async () => {
    list.mockResolvedValue(page([customerRow()], 60))
    open()
    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastQuery()[0]).toMatchObject({ page: 2 }))
    expect(await screen.findByText('Showing 26–50 of 60')).toBeInTheDocument()
  })

  it('goes back to page 1 when a filter changes', async () => {
    list.mockResolvedValue(page([customerRow()], 60))
    open('/customers?page=3')
    await screen.findByRole('link', { name: 'Cleo Client' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await waitFor(() => expect(lastQuery()[0]).toMatchObject({ page: 1 }))
  })

  it('explains an out-of-range page and offers the first page', async () => {
    list.mockResolvedValue(ok({ rows: [], total: 60 }))
    open('/customers?page=9')
    expect(await screen.findByText('There are no customers on this page.')).toBeInTheDocument()
    list.mockResolvedValue(page([customerRow()], 60))
    await userEvent.click(screen.getByRole('button', { name: 'Go to the first page' }))
    await waitFor(() => expect(lastQuery()[0]).toMatchObject({ page: 1 }))
  })

  it('shows a first-use message when there are no customers at all', async () => {
    list.mockResolvedValue(page([], 0))
    open()
    expect(await screen.findByText('You have no customers yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add your first customer' })).toHaveAttribute(
      'href',
      '/customers/new',
    )
  })

  it('shows a different message, with a way out, when filters match nothing', async () => {
    list.mockResolvedValue(page([], 0))
    open('/customers?status=inactive')
    expect(
      await screen.findByText('No customers match your search or filters.'),
    ).toBeInTheDocument()
    list.mockResolvedValue(page())
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    await waitFor(() => expect(lastQuery()[1]).toEqual({ status: '', segment: '' }))
  })

  it('shows an error with a retry', async () => {
    list.mockResolvedValueOnce(
      err({
        code: 'network',
        message: 'Cannot reach the server. Check your connection and try again.',
      }),
    )
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Cleo Client' })).toBeInTheDocument()
  })

  it('links to the profile, edit form and the customer’s properties from the row menu', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Cleo Client' }))
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/customers/c1',
    )
    expect(screen.getByRole('link', { name: 'Edit details' })).toHaveAttribute(
      'href',
      '/customers/c1/edit',
    )
    expect(screen.getByRole('link', { name: 'Linked properties' })).toHaveAttribute(
      'href',
      '/properties?customer=c1',
    )
  })

  it('deactivates a customer after confirmation and refreshes the list', async () => {
    s.setCustomerStatus.mockResolvedValue(ok({ id: 'c1' }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Cleo Client' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    const dialog = screen.getByRole('dialog', { name: 'Deactivate customer' })
    expect(within(dialog).getByText(/records and history are kept/)).toBeInTheDocument()
    expect(s.setCustomerStatus).not.toHaveBeenCalled()
    const callsBefore = list.mock.calls.length
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(s.setCustomerStatus).toHaveBeenCalledWith('c1', 'inactive'))
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(callsBefore))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers to reactivate an inactive customer', async () => {
    list.mockResolvedValue(page([customerRow({ status: 'inactive' })]))
    s.setCustomerStatus.mockResolvedValue(ok({ id: 'c1' }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Cleo Client' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate account' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }),
    )
    await waitFor(() => expect(s.setCustomerStatus).toHaveBeenCalledWith('c1', 'active'))
  })

  it('keeps the dialog open and explains when deactivation is refused', async () => {
    s.setCustomerStatus.mockResolvedValue(
      err({ code: 'forbidden', message: 'You do not have permission to do this.' }),
    )
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Cleo Client' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    )
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'You do not have permission',
    )
  })

  it('is closed to clients', async () => {
    renderAt(<App />, signedInAs('client'), '/customers')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })
})
