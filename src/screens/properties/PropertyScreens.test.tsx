import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as maintenance from '@/services/maintenance'
import * as svc from '@/services/properties'
import { maintenanceFixture, propertyFixture, propertyRow } from '@/test/fixtures'
import { err, ok } from '@/utils/result'

vi.mock('@/services/properties', () => ({
  listProperties: vi.fn(),
  getProperty: vi.fn(),
  createProperty: vi.fn(),
  updateProperty: vi.fn(),
  getPropertyMeters: vi.fn(),
  getPropertyReadings: vi.fn(),
  searchCustomerOptions: vi.fn(),
  getCustomerOption: vi.fn(),
}))

vi.mock('@/services/maintenance', () => ({ getPropertyMaintenance: vi.fn() }))

const s = vi.mocked(svc)
const getMaintenance = vi.mocked(maintenance.getPropertyMaintenance)
const CUSTOMER = '11111111-1111-1111-1111-111111111111'
const cleo = { id: 'c1', name: 'Cleo Client', companyName: null, email: 'client1@umbane.test' }
const kagiso = {
  id: 'c2',
  name: 'Kagiso Holdings',
  companyName: 'Kagiso Holdings (Pty) Ltd',
  email: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  s.listProperties.mockResolvedValue(
    ok({
      rows: [
        propertyRow(),
        propertyRow({
          id: 'p2',
          reference: null,
          name: null,
          address: '4 Main Road',
          suburb: null,
          city: 'Beaufort West',
          propertyType: 'commercial',
          units: null,
          status: 'maintenance',
          ownerName: 'Thabo Mokoena',
          meterCount: 0,
        }),
      ],
      total: 2,
    }),
  )
  s.getProperty.mockResolvedValue(ok(propertyFixture()))
  s.getPropertyMeters.mockResolvedValue(ok([]))
  s.getPropertyReadings.mockResolvedValue(ok([]))
  getMaintenance.mockResolvedValue(ok([]))
  s.searchCustomerOptions.mockResolvedValue(ok([cleo, kagiso]))
  s.getCustomerOption.mockResolvedValue(ok(cleo))
})

const open = (route: string, role: 'staff' | 'client' = 'staff') =>
  renderAt(<App />, signedInAs(role), route)
const lastList = () => s.listProperties.mock.calls.at(-1)!

describe('property list', () => {
  it('shows reference, name, owner, address, type, units, meters and status', async () => {
    open('/properties')
    const row = (await screen.findByRole('link', { name: 'Sunrise Apartments' })).closest('tr')!
    expect(within(row).getByText('PROP-1001')).toBeInTheDocument()
    expect(within(row).getByText('Cleo Client')).toBeInTheDocument()
    expect(within(row).getByText('12 Long Street, City Bowl, Cape Town')).toBeInTheDocument()
    expect(within(row).getByText('Residential')).toBeInTheDocument()
    expect(within(row).getByText('24')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
  })

  it('falls back to the address when a property has no name, and dashes for blanks', async () => {
    open('/properties')
    const row = (await screen.findByRole('link', { name: '4 Main Road' })).closest('tr')!
    expect(within(row).getByText('Maintenance')).toBeInTheDocument()
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(2) // no reference, no units
  })

  it('filters by type and status', async () => {
    open('/properties')
    await screen.findByRole('link', { name: 'Sunrise Apartments' })
    await userEvent.selectOptions(screen.getByLabelText('Property type'), 'commercial')
    await waitFor(() => expect(lastList()[1]).toMatchObject({ type: 'commercial' }))
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'maintenance')
    await waitFor(() =>
      expect(lastList()[1]).toMatchObject({ type: 'commercial', status: 'maintenance' }),
    )
  })

  it('shows one customer’s properties from a link, and can clear that filter', async () => {
    open(`/properties?customer=${CUSTOMER}`)
    expect(await screen.findByText('Showing the properties of one customer.')).toBeInTheDocument()
    expect(lastList()[1]).toMatchObject({ customerId: CUSTOMER })
    expect(screen.getByRole('link', { name: /Register Property/ })).toHaveAttribute(
      'href',
      `/properties/new?customer=${CUSTOMER}`,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Show all properties' }))
    await waitFor(() => expect(lastList()[1]).toMatchObject({ customerId: '' }))
    expect(screen.queryByText('Showing the properties of one customer.')).toBeNull()
  })

  it('ignores a malformed customer id instead of sending it to the query', async () => {
    open('/properties?customer=x,or(1=1)')
    await screen.findByRole('link', { name: 'Sunrise Apartments' })
    expect(lastList()[1]).toMatchObject({ customerId: '' })
    expect(screen.queryByText('Showing the properties of one customer.')).toBeNull()
  })

  it('shows empty states, and an error with retry', async () => {
    s.listProperties.mockResolvedValueOnce(ok({ rows: [], total: 0 }))
    const { unmount } = open('/properties')
    expect(await screen.findByText('No properties are registered yet.')).toBeInTheDocument()
    unmount()

    s.listProperties.mockResolvedValueOnce(
      err({
        code: 'network',
        message: 'Cannot reach the server. Check your connection and try again.',
      }),
    )
    open('/properties')
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Sunrise Apartments' })).toBeInTheDocument()
  })

  it('lets a client view their properties but not register one', async () => {
    open('/properties', 'client')
    expect(await screen.findByRole('link', { name: 'Sunrise Apartments' })).toBeInTheDocument()
    unmountAll()
    open('/properties/new', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Street address')).toBeNull()
    unmountAll()
    open('/properties/p1/edit', 'client')
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })
})

function unmountAll() {
  document.body.innerHTML = ''
}

describe('register property', () => {
  it('requires an owner and an address, focusing the first problem', async () => {
    open('/properties/new')
    await userEvent.click(await screen.findByRole('button', { name: 'Register Property' }))
    expect(screen.getByText('Choose the customer who owns this property.')).toBeInTheDocument()
    expect(screen.getByText('Enter the street address.')).toBeInTheDocument()
    expect(screen.getByLabelText('Owner')).toHaveFocus()
    expect(s.createProperty).not.toHaveBeenCalled()
  })

  it('searches for an owner, chooses one, and can change the choice', async () => {
    open('/properties/new')
    await userEvent.type(await screen.findByLabelText('Owner'), 'kag')
    await waitFor(() => expect(s.searchCustomerOptions).toHaveBeenLastCalledWith('kag'), {
      timeout: 3000,
    })
    await userEvent.click(
      await screen.findByRole('button', {
        name: /Kagiso Holdings \(Kagiso Holdings \(Pty\) Ltd\)/,
      }),
    )
    expect(screen.getByText('Kagiso Holdings (Kagiso Holdings (Pty) Ltd)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Owner')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Change owner' }))
    expect(await screen.findByLabelText('Owner')).toBeInTheDocument()
  })

  it('shows when no customer matches the search', async () => {
    s.searchCustomerOptions.mockResolvedValue(ok([]))
    open('/properties/new')
    await userEvent.type(await screen.findByLabelText('Owner'), 'zzz')
    expect(await screen.findByText('No customers match that search.')).toBeInTheDocument()
  })

  it('arrives with the owner already chosen from a customer profile', async () => {
    open('/properties/new?customer=c1')
    expect(await screen.findByText('Cleo Client')).toBeInTheDocument()
    expect(s.getCustomerOption).toHaveBeenCalledWith('c1')
    expect(screen.queryByLabelText('Owner')).toBeNull()
  })

  it('validates units, reference and postal code', async () => {
    open('/properties/new?customer=c1')
    await screen.findByText('Cleo Client')
    await userEvent.type(screen.getByLabelText('Street address'), '173 Oxford Road')
    await userEvent.type(screen.getByLabelText('Number of units'), '0')
    await userEvent.type(screen.getByLabelText('Property ID'), '!!')
    await userEvent.type(screen.getByLabelText('Postal code'), '21')
    await userEvent.click(screen.getByRole('button', { name: 'Register Property' }))
    expect(screen.getByText('Enter a whole number of units, 1 or more.')).toBeInTheDocument()
    expect(screen.getByText(/Use up to 30 letters, numbers, dashes or slashes/)).toBeInTheDocument()
    expect(screen.getByText('Postal codes have four digits.')).toBeInTheDocument()
    expect(s.createProperty).not.toHaveBeenCalled()
  })

  it('saves and opens the new property with a confirmation', async () => {
    s.createProperty.mockResolvedValue(ok({ id: 'p1' }))
    open('/properties/new?customer=c1')
    await screen.findByText('Cleo Client')
    await userEvent.type(screen.getByLabelText('Street address'), ' 173 Oxford Road ')
    await userEvent.type(screen.getByLabelText('Number of units'), '24')
    await userEvent.selectOptions(screen.getByLabelText('Property type'), 'mixed_use')
    await userEvent.click(screen.getByRole('button', { name: 'Register Property' }))
    await waitFor(() => expect(s.createProperty).toHaveBeenCalledTimes(1))
    expect(s.createProperty.mock.calls[0][0]).toMatchObject({
      customerId: 'c1',
      address: '173 Oxford Road',
      units: 24,
      propertyType: 'mixed_use',
      reference: null,
      status: 'active',
    })
    expect(await screen.findByText('Property registered.')).toBeInTheDocument()
  })

  it('shows a duplicate address under the address field', async () => {
    s.createProperty.mockResolvedValue(
      err({
        code: 'conflict',
        field: 'address',
        message: 'This customer already has a property at this address.',
      }),
    )
    open('/properties/new?customer=c1')
    await screen.findByText('Cleo Client')
    await userEvent.type(screen.getByLabelText('Street address'), '12 Long Street')
    await userEvent.click(screen.getByRole('button', { name: 'Register Property' }))
    expect(
      await screen.findByText('This customer already has a property at this address.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Street address')).toHaveValue('12 Long Street')
  })

  it('shows a duplicate property ID under that field', async () => {
    s.createProperty.mockResolvedValue(
      err({
        code: 'conflict',
        field: 'reference',
        message: 'A property with this reference already exists.',
      }),
    )
    open('/properties/new?customer=c1')
    await screen.findByText('Cleo Client')
    await userEvent.type(screen.getByLabelText('Street address'), '1 Main')
    await userEvent.type(screen.getByLabelText('Property ID'), 'PROP-1001')
    await userEvent.click(screen.getByRole('button', { name: 'Register Property' }))
    expect(
      await screen.findByText('A property with this reference already exists.'),
    ).toBeInTheDocument()
  })
})

describe('edit property', () => {
  it('loads the property, including its owner and status', async () => {
    open('/properties/p1/edit')
    expect(await screen.findByLabelText('Street address')).toHaveValue('12 Long Street')
    expect(screen.getByLabelText('Property ID')).toHaveValue('PROP-1001')
    expect(screen.getByLabelText('Number of units')).toHaveValue('24')
    expect(screen.getByLabelText('Status')).toHaveValue('active')
    expect(screen.getByText('Cleo Client')).toBeInTheDocument()
  })

  it('saves changes against the property id', async () => {
    s.updateProperty.mockResolvedValue(ok({ id: 'p1' }))
    open('/properties/p1/edit')
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'offline')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(s.updateProperty).toHaveBeenCalledTimes(1))
    expect(s.updateProperty.mock.calls[0][0]).toBe('p1')
    expect(s.updateProperty.mock.calls[0][1]).toMatchObject({
      status: 'offline',
      customerId: 'c1',
      units: 24,
    })
    expect(await screen.findByText('Property updated.')).toBeInTheDocument()
  })
})

describe('property details', () => {
  it('shows information, owner link and full address', async () => {
    open('/properties/p1')
    expect(await screen.findByRole('heading', { name: 'Sunrise Apartments' })).toBeInTheDocument()
    const owner = screen.getByRole('region', { name: 'Owner' })
    expect(within(owner).getByRole('link', { name: 'Cleo Client' })).toHaveAttribute(
      'href',
      '/customers/c1',
    )
    expect(
      within(owner).getByText('12 Long Street, City Bowl, Cape Town 8001, Western Cape'),
    ).toBeInTheDocument()
    const info = screen.getByRole('region', { name: 'Property information' })
    expect(within(info).getByText('Residential')).toBeInTheDocument()
    expect(within(info).getByText('24')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      '/properties/p1/edit',
    )
  })

  it('lists linked meters and the latest readings', async () => {
    s.getPropertyMeters.mockResolvedValue(
      ok([{ id: 'm1', serialNumber: 'MTR-0001', status: 'active', installedOn: '2025-01-15' }]),
    )
    s.getPropertyReadings.mockResolvedValue(
      ok([
        {
          id: 'r1',
          serialNumber: 'MTR-0001',
          readingDate: '2026-10-01',
          readingValue: 1385.25,
          isEstimate: true,
        },
      ]),
    )
    open('/properties/p1')
    const meters = await screen.findByRole('region', { name: 'Linked electricity meters' })
    expect(await within(meters).findByText('MTR-0001')).toBeInTheDocument()
    expect(within(meters).getByText('15 Jan 2025')).toBeInTheDocument()
    const history = screen.getByRole('region', { name: 'Latest meter readings' })
    expect(await within(history).findByText('1,385.25')).toBeInTheDocument()
    expect(within(history).getByText('Estimate')).toBeInTheDocument()
    expect(within(meters).getByRole('link', { name: /Add meter/ })).toHaveAttribute(
      'href',
      '/electricity-meters/new?property=p1',
    )
  })

  it('shows maintenance to staff, and neither it nor "Add meter" to clients', async () => {
    getMaintenance.mockResolvedValue(ok([maintenanceFixture({ outcome: 'Seal replaced' })]))
    const { unmount } = open('/properties/p1')
    const panel = await screen.findByRole('region', { name: 'Service history' })
    expect(await within(panel).findByText(/Tamper seal.*Seal replaced/)).toBeInTheDocument()
    unmount()

    getMaintenance.mockClear()
    open('/properties/p1', 'client')
    expect(await screen.findByRole('region', { name: 'Owner' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Service history' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Add meter/ })).toBeNull()
    expect(getMaintenance).not.toHaveBeenCalled()
  })

  it('shows empty messages and keeps working when the meters panel fails', async () => {
    s.getPropertyMeters.mockResolvedValue(
      err({ code: 'forbidden', message: 'You do not have access to this information.' }),
    )
    open('/properties/p1')
    const meters = await screen.findByRole('region', { name: 'Linked electricity meters' })
    expect(await within(meters).findByRole('alert')).toHaveTextContent('You do not have access')
    expect(
      await screen.findByText('No meter readings have been recorded for this property.'),
    ).toBeInTheDocument()
  })

  it('shows not-found for a missing property', async () => {
    s.getProperty.mockResolvedValue(
      err({ code: 'not_found', message: 'This property could not be found.' }),
    )
    open('/properties/nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('This property could not be found.')
  })
})
