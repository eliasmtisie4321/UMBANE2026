import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as svc from '@/services/customers'
import { customerFixture } from '@/test/fixtures'
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

beforeEach(() => {
  vi.clearAllMocks()
  s.getCustomer.mockResolvedValue(ok(customerFixture()))
  s.getCustomerProperties.mockResolvedValue(ok([]))
  s.getCustomerInvoices.mockResolvedValue(ok([]))
  s.getCustomerOrders.mockResolvedValue(ok([]))
  s.getCustomerTickets.mockResolvedValue(ok([]))
})

const open = (route: string, role: 'staff' | 'client' = 'staff') =>
  renderAt(<App />, signedInAs(role), route)
const type = (label: string, text: string) => userEvent.type(screen.getByLabelText(label), text)

describe('add customer', () => {
  it('rejects an empty form, explains each problem and focuses the first invalid field', async () => {
    open('/customers/new')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    expect(screen.getByText('Enter the customer’s full name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a phone number or an email address.')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveFocus()
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true')
    expect(s.createCustomer).not.toHaveBeenCalled()
  })

  it('clears an error as soon as that field is edited', async () => {
    open('/customers/new')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    await type('Full name', 'Thabo')
    expect(screen.queryByText('Enter the customer’s full name.')).toBeNull()
  })

  it('validates the ID number, email, phone and postal code', async () => {
    open('/customers/new')
    await type('Full name', 'Thabo Mokoena')
    await type('ID number', '8805145028085')
    await type('Email address', 'nope')
    await type('Phone number', '123')
    await type('Postal code', '21')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    expect(screen.getByText('Enter a valid 13-digit South African ID number.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText(/Enter a valid phone number, e.g. 082/)).toBeInTheDocument()
    expect(screen.getByText('Postal codes have four digits.')).toBeInTheDocument()
    expect(s.createCustomer).not.toHaveBeenCalled()
  })

  it('shows company fields only for business customers, and requires the company name', async () => {
    open('/customers/new')
    expect(screen.queryByLabelText('Company name')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Business' }))
    expect(screen.getByLabelText('Company name')).toBeInTheDocument()
    await type('Full name', 'Thabo Mokoena')
    await type('Phone number', '0824419082')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    expect(screen.getByText('Enter the company name.')).toBeInTheDocument()
    expect(screen.getByLabelText('Company name')).toHaveFocus()
  })

  it('saves normalised values and opens the new profile with a confirmation', async () => {
    s.createCustomer.mockResolvedValue(ok({ id: 'c1' }))
    open('/customers/new')
    await type('Full name', '  Thabo Mokoena ')
    await type('Email address', 'THABO@Example.co.za')
    await type('Phone number', '082 441 9082')
    await userEvent.selectOptions(screen.getByLabelText('Province'), 'Gauteng')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    await waitFor(() => expect(s.createCustomer).toHaveBeenCalledTimes(1))
    expect(s.createCustomer.mock.calls[0][0]).toMatchObject({
      name: 'Thabo Mokoena',
      email: 'thabo@example.co.za',
      phone: '+27824419082',
      province: 'Gauteng',
      altPhone: null,
      companyName: null,
      status: 'active',
    })
    expect(await screen.findByText('Customer created.')).toBeInTheDocument()
    // The notice shows at once; the profile itself loads a moment later.
    expect(await screen.findByRole('heading', { name: 'Cleo Client' })).toBeInTheDocument()
  })

  it('shows a duplicate email under the email field and keeps what was typed', async () => {
    s.createCustomer.mockResolvedValue(
      err({
        code: 'conflict',
        field: 'email',
        message: 'A customer with this email address already exists.',
      }),
    )
    open('/customers/new')
    await type('Full name', 'Thabo Mokoena')
    await type('Email address', 'client1@umbane.test')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    const email = screen.getByLabelText('Email address')
    expect(
      await screen.findByText('A customer with this email address already exists.'),
    ).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveValue('client1@umbane.test')
    expect(screen.getByLabelText('Full name')).toHaveValue('Thabo Mokoena')
    // Editing the email clears the stale message.
    await userEvent.type(email, 'x')
    expect(screen.queryByText('A customer with this email address already exists.')).toBeNull()
  })

  it('shows a general failure at the top of the form', async () => {
    s.createCustomer.mockResolvedValue(
      err({ code: 'forbidden', message: 'You do not have permission to do this.' }),
    )
    open('/customers/new')
    await type('Full name', 'Thabo Mokoena')
    await type('Phone number', '0824419082')
    await userEvent.click(screen.getByRole('button', { name: 'Save Customer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    )
  })

  it('is closed to clients', async () => {
    open('/customers/new', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).toBeNull()
  })
})

describe('edit customer', () => {
  it('loads the customer into the form, including status', async () => {
    open('/customers/c1/edit')
    expect(await screen.findByLabelText('Full name')).toHaveValue('Cleo Client')
    expect(screen.getByLabelText('Email address')).toHaveValue('client1@umbane.test')
    expect(screen.getByLabelText('Province')).toHaveValue('Western Cape')
    expect(screen.getByLabelText('Status')).toHaveValue('active')
  })

  it('does not save when nothing changed', async () => {
    open('/customers/c1/edit')
    await screen.findByLabelText('Full name')
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    expect(await screen.findByText('No changes to save.')).toBeInTheDocument()
    expect(s.updateCustomer).not.toHaveBeenCalled()
  })

  it('lists exactly what changed and only saves on confirmation', async () => {
    s.updateCustomer.mockResolvedValue(ok({ id: 'c1' }))
    open('/customers/c1/edit')
    const city = await screen.findByLabelText('City')
    await userEvent.clear(city)
    await userEvent.type(city, 'Paarl')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'inactive')
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))

    const dialog = screen.getByRole('dialog', { name: 'Confirm customer changes' })
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['City', 'Status'])
    expect(s.updateCustomer).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm & Save' }))
    await waitFor(() => expect(s.updateCustomer).toHaveBeenCalledTimes(1))
    expect(s.updateCustomer.mock.calls[0][0]).toBe('c1')
    expect(s.updateCustomer.mock.calls[0][1]).toMatchObject({ city: 'Paarl', status: 'inactive' })
    expect(await screen.findByText('Customer updated.')).toBeInTheDocument()
  })

  it('returns to editing without saving when the dialog is dismissed', async () => {
    open('/customers/c1/edit')
    const city = await screen.findByLabelText('City')
    await userEvent.type(city, 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('City')).toHaveValue('Cape Townx')
    expect(s.updateCustomer).not.toHaveBeenCalled()
  })

  it('puts a duplicate ID number on that field after closing the dialog', async () => {
    s.updateCustomer.mockResolvedValue(
      err({
        code: 'conflict',
        field: 'idNumber',
        message: 'A customer with this ID number already exists.',
      }),
    )
    open('/customers/c1/edit')
    const id = await screen.findByLabelText('ID number')
    await userEvent.clear(id)
    await userEvent.type(id, '8001015009087')
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm & Save' }),
    )
    expect(
      await screen.findByText('A customer with this ID number already exists.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows not-found for a customer that does not exist or is hidden by permissions', async () => {
    s.getCustomer.mockResolvedValue(
      err({ code: 'not_found', message: 'This customer could not be found.' }),
    )
    open('/customers/nope/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('This customer could not be found.')
  })
})

describe('customer profile', () => {
  it('shows account, contact and address details with the ID number masked', async () => {
    open('/customers/c1')
    expect(await screen.findByRole('heading', { name: 'Cleo Client' })).toBeInTheDocument()
    const account = screen.getByRole('region', { name: 'Account' })
    expect(within(account).getByText('880514•••••84')).toBeInTheDocument()
    expect(within(account).queryByText('8805145028084')).toBeNull()
    expect(within(account).getByText('Residential')).toBeInTheDocument()
    expect(within(account).getByText('5 Jan 2026')).toBeInTheDocument()
    const contact = screen.getByRole('region', { name: 'Contact' })
    expect(within(contact).getByRole('link', { name: 'client1@umbane.test' })).toHaveAttribute(
      'href',
      'mailto:client1@umbane.test',
    )
    expect(within(contact).getByRole('link', { name: '+27 82 000 0001' })).toHaveAttribute(
      'href',
      'tel:+27820000001',
    )
    expect(
      within(contact).getByText('12 Long Street, City Bowl, Cape Town 8001, Western Cape'),
    ).toBeInTheDocument()
    expect(screen.getByText('Prefers email')).toBeInTheDocument()
  })

  it('lists related properties, invoices, orders and tickets', async () => {
    s.getCustomerProperties.mockResolvedValue(
      ok([
        {
          id: 'p1',
          reference: 'PROP-1001',
          name: 'Sunrise Apartments',
          address: '12 Long Street',
          city: 'Cape Town',
          status: 'active',
          meterCount: 3,
        },
      ]),
    )
    s.getCustomerInvoices.mockResolvedValue(
      ok([
        {
          id: 'i1',
          invoiceNumber: 'INV-0001',
          status: 'partially_paid',
          total: 1150,
          balance: 250,
          dueDate: '2026-12-15',
          isOverdue: false,
        },
      ]),
    )
    s.getCustomerOrders.mockResolvedValue(
      ok([{ id: 'o1', status: 'confirmed', total: 850, createdAt: '2026-10-01T10:00:00Z' }]),
    )
    s.getCustomerTickets.mockResolvedValue(
      ok([
        {
          id: 't1',
          reference: 'TKT-0001',
          subject: 'Meter display is blank',
          status: 'in_progress',
          priority: 'high',
          createdAt: '2026-11-01T10:00:00Z',
        },
      ]),
    )
    open('/customers/c1')
    const properties = await screen.findByRole('region', { name: 'Properties' })
    expect(
      await within(properties).findByRole('link', { name: 'Sunrise Apartments' }),
    ).toHaveAttribute('href', '/properties/p1')
    expect(within(properties).getByText('3')).toBeInTheDocument()
    const invoices = screen.getByRole('region', { name: 'Invoices' })
    expect(await within(invoices).findByText('INV-0001')).toBeInTheDocument()
    expect(within(invoices).getByText('Partially paid')).toBeInTheDocument()
    expect(within(invoices).getByText('R 250.00')).toBeInTheDocument()
    expect(
      await within(screen.getByRole('region', { name: 'Orders' })).findByText('Confirmed'),
    ).toBeInTheDocument()
    const tickets = screen.getByRole('region', { name: 'Support tickets' })
    expect(await within(tickets).findByText('Meter display is blank')).toBeInTheDocument()
    expect(within(tickets).getByText('In progress')).toBeInTheDocument()
  })

  it('shows empty messages for a customer with no related records', async () => {
    open('/customers/c1')
    expect(
      await screen.findByText('No properties are registered to this customer yet.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('No invoices for this customer.')).toBeInTheDocument()
    expect(await screen.findByText('No orders for this customer.')).toBeInTheDocument()
    expect(await screen.findByText('No support tickets for this customer.')).toBeInTheDocument()
  })

  it('fails one related panel without hiding the rest', async () => {
    s.getCustomerInvoices.mockResolvedValue(
      err({
        code: 'unknown',
        message: 'Invoices is unavailable until the latest database update is applied.',
      }),
    )
    open('/customers/c1')
    const invoices = await screen.findByRole('region', { name: 'Invoices' })
    expect(await within(invoices).findByRole('alert')).toHaveTextContent('latest database update')
    expect(await screen.findByText('No orders for this customer.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cleo Client' })).toBeInTheDocument()
  })

  it('offers edit and add-property links for this customer', async () => {
    open('/customers/c1')
    expect(await screen.findByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      '/customers/c1/edit',
    )
    expect(screen.getByRole('link', { name: /Add property/ })).toHaveAttribute(
      'href',
      '/properties/new?customer=c1',
    )
  })

  it('deactivates after confirmation and reloads the customer', async () => {
    s.setCustomerStatus.mockResolvedValue(ok({ id: 'c1' }))
    open('/customers/c1')
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    const callsBefore = s.getCustomer.mock.calls.length
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    )
    await waitFor(() => expect(s.setCustomerStatus).toHaveBeenCalledWith('c1', 'inactive'))
    await waitFor(() => expect(s.getCustomer.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('shows reactivate for an inactive customer', async () => {
    s.getCustomer.mockResolvedValue(ok(customerFixture({ status: 'inactive' })))
    open('/customers/c1')
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows not-found when the customer does not exist', async () => {
    s.getCustomer.mockResolvedValue(
      err({ code: 'not_found', message: 'This customer could not be found.' }),
    )
    open('/customers/nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('This customer could not be found.')
  })
})
