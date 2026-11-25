import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as maintenanceService from '@/services/maintenance'
import * as meterService from '@/services/meters'
import { maintenanceFixture, meterFixture, meterRow, readingFixture } from '@/test/fixtures'
import type { UserRole } from '@/types/auth'
import { businessToday } from '@/utils/consumption'
import { err, ok } from '@/utils/result'

vi.mock('@/services/meters')
vi.mock('@/services/maintenance')

const m = vi.mocked(meterService)
const w = vi.mocked(maintenanceService)
const option = {
  id: 'm1',
  serialNumber: 'MTR-0001',
  propertyName: 'Sunrise Apartments',
  customerName: 'Cleo Client',
  installedOn: '2025-01-15',
}

beforeEach(() => {
  vi.resetAllMocks()
  m.listMeters.mockResolvedValue(ok({ rows: [meterRow()], total: 1 }))
  m.getMeterSummary.mockResolvedValue(
    ok({ inService: 200, active: 190, inactive: 5, faulty: 3, maintenance: 2, retired: 7 }),
  )
  m.getTotalConsumption.mockResolvedValue(ok([]))
  m.getMeterConsumption.mockResolvedValue(ok([]))
  m.getMeter.mockResolvedValue(ok(meterFixture()))
  m.getReadings.mockResolvedValue(ok({ rows: [readingFixture()], total: 1 }))
  m.getReadingsAround.mockResolvedValue(ok([]))
  m.searchMeterOptions.mockResolvedValue(ok([option]))
  m.searchPropertyOptions.mockResolvedValue(ok([]))
  m.getPropertyOption.mockResolvedValue(
    ok({ id: 'p1', name: 'Sunrise Apartments', detail: 'PROP-1001' }),
  )
  w.getMeterMaintenance.mockResolvedValue(ok([]))
  w.listStaffOptions.mockResolvedValue(ok([{ id: 'u9', name: 'Thabo Mokoena' }]))
  w.listMaintenance.mockResolvedValue(ok({ rows: [maintenanceFixture()], total: 1 }))
  w.getMaintenanceCounts.mockResolvedValue(
    ok({ scheduled: 4, pending: 2, inProgress: 1, completed: 9, urgent: 1, overdue: 1 }),
  )
})

const open = (route: string, role: UserRole = 'staff') =>
  renderAt(<App />, signedInAs(role), `/electricity-meters${route}`)
const lastList = () => m.listMeters.mock.calls.at(-1)!

describe('meter directory', () => {
  it('shows totals and each meter with its latest reading and estimate', async () => {
    m.listMeters.mockResolvedValue(
      ok({ rows: [meterRow({ latestIsEstimate: true, latestFlag: 'high' })], total: 1 }),
    )
    open('')
    const row = (await screen.findByRole('link', { name: 'MTR-0001' })).closest('tr')!
    for (const text of [
      'Smart Prepaid',
      'Cleo Client',
      '14,850.5 kWh',
      '243 kWh',
      'Active',
      'Estimate',
      'Unusually high',
    ])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(await screen.findByText('95% of meters in service')).toBeInTheDocument()
    expect(screen.getByText('7 retired')).toBeInTheDocument()
    expect(
      screen.getByText('Consumption appears once a meter has at least two readings.'),
    ).toBeInTheDocument()
  })

  it('filters through the URL and ignores a malformed property id', async () => {
    open('?property=x,or(1=1)&status=bogus')
    await screen.findByRole('link', { name: 'MTR-0001' })
    expect(lastList()[1]).toEqual({ type: '', status: '', propertyId: '' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'faulty')
    await waitFor(() => expect(lastList()[1]).toMatchObject({ status: 'faulty' }))
  })

  it('shows dashes, not zeros, for a meter without readings', async () => {
    m.listMeters.mockResolvedValue(
      ok({
        rows: [meterRow({ latestDate: null, latestValue: null, estimatedMonthly: null })],
        total: 1,
      }),
    )
    open('')
    const row = (await screen.findByRole('link', { name: 'MTR-0001' })).closest('tr')!
    expect(within(row).getAllByText('-')).toHaveLength(2)
  })

  it('recovers from an error', async () => {
    m.listMeters.mockResolvedValueOnce(
      err({ code: 'network', message: 'Cannot reach the server.' }),
    )
    open('')
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'MTR-0001' })).toBeInTheDocument()
  })

  it('draws the chart with caveats in its description and table', async () => {
    m.getTotalConsumption.mockResolvedValue(
      ok([
        { month: '2026-10-01', kwh: 310, daysCovered: null, hasEstimate: true },
        { month: '2026-11-01', kwh: 90, daysCovered: null, hasEstimate: false },
      ]),
    )
    open('')
    expect(
      await screen.findByRole('img', {
        name: 'Consumption by month: Oct 310 kWh (Includes estimates), Nov 90 kWh',
      }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'View as table' }))
    const table = screen.getByRole('table', { name: 'Electricity consumption per month' })
    expect(within(table).getByText('Includes estimates')).toBeInTheDocument()
  })

  it('gives clients a read-only view', async () => {
    const { unmount } = open('', 'client')
    await screen.findByRole('link', { name: 'MTR-0001' })
    for (const name of [/Add Meter/, /Record Reading/, /Maintenance/])
      expect(screen.queryByRole('link', { name })).toBeNull()
    unmount()
    for (const route of ['/new', '/maintenance', '/readings/new', '/m1/edit']) {
      const view = open(route, 'client')
      expect(
        await screen.findByRole('heading', { name: /do not have access/i }),
      ).toBeInTheDocument()
      view.unmount()
    }
    expect(w.listMaintenance).not.toHaveBeenCalled()
  })
})

describe('register meter', () => {
  it('reports missing fields and focuses the first', async () => {
    open('/new')
    await userEvent.click(await screen.findByRole('button', { name: 'Save Meter' }))
    expect(screen.getByText('Enter the serial number.')).toBeInTheDocument()
    expect(screen.getByText('Choose the property this meter is installed at.')).toBeInTheDocument()
    expect(screen.getByLabelText('Serial number')).toHaveFocus()
    expect(m.registerMeter).not.toHaveBeenCalled()
  })

  it('saves, and shows a duplicate serial on its field', async () => {
    m.registerMeter.mockResolvedValueOnce(
      err({
        code: 'conflict',
        field: 'serialNumber',
        message: 'A meter with this serial number already exists.',
      }),
    )
    open('/new?property=p1')
    expect(await screen.findByText('Sunrise Apartments')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Serial number'), 'MTR-0001')
    await userEvent.selectOptions(screen.getByLabelText('Meter type'), 'conventional')
    await userEvent.selectOptions(screen.getByLabelText('Meter category'), 'common_area')
    await userEvent.type(screen.getByLabelText('Initial reading (kWh)'), '12.5')
    await userEvent.type(screen.getByLabelText('Installation date'), '2026-01-10')
    await userEvent.click(screen.getByRole('button', { name: 'Save Meter' }))
    expect(
      await screen.findByText('A meter with this serial number already exists.'),
    ).toBeInTheDocument()

    m.registerMeter.mockResolvedValueOnce(ok({ id: 'm1' }))
    await userEvent.type(screen.getByLabelText('Serial number'), '-B')
    await userEvent.click(screen.getByRole('button', { name: 'Save Meter' }))
    expect(await screen.findByText('Meter registered.')).toBeInTheDocument()
    expect(m.registerMeter.mock.calls[1][0]).toMatchObject({
      propertyId: 'p1',
      serialNumber: 'MTR-0001-B',
      initialReading: 12.5,
      installedOn: '2026-01-10',
    })
  })

  it('edits without the initial reading, and hides status for a retired meter', async () => {
    m.updateMeter.mockResolvedValue(ok({ id: 'm1' }))
    const { unmount } = open('/m1/edit')
    expect(await screen.findByLabelText('Serial number')).toHaveValue('MTR-0001')
    expect(screen.queryByLabelText('Initial reading (kWh)')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'faulty')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Meter updated.')).toBeInTheDocument()
    expect(m.updateMeter.mock.calls[0]).toMatchObject(['m1', { status: 'faulty' }])
    unmount()

    m.getMeter.mockResolvedValue(ok(meterFixture({ status: 'replaced', retiredOn: '2026-11-01' })))
    open('/m1/edit')
    await screen.findByLabelText('Serial number')
    expect(screen.queryByLabelText('Status')).toBeNull()
  })
})

describe('record reading', () => {
  const around = [
    { readingDate: '2026-01-01', readingValue: 1000 },
    { readingDate: '2026-02-01', readingValue: 1310 },
    { readingDate: '2026-03-01', readingValue: 1590 },
  ]
  const enter = async (date: string, value: string) => {
    const dateInput = await screen.findByLabelText('Reading date')
    await userEvent.clear(dateInput)
    await userEvent.type(dateInput, date)
    const input = screen.getByLabelText('Current reading (kWh)')
    await userEvent.clear(input)
    await userEvent.type(input, value)
  }
  const submit = () => userEvent.click(screen.getByRole('button', { name: 'Submit Reading' }))

  it('shows the previous reading and consumption, then saves', async () => {
    m.getReadingsAround.mockResolvedValue(ok(around))
    m.recordReading.mockResolvedValue(ok({ id: 'r9', flag: null }))
    open('/readings/new?meter=m1')
    await enter('2026-03-31', '1890')
    expect(await screen.findByText('300 kWh over 30 days')).toBeInTheDocument()
    expect(screen.getByText('1,590 kWh on 1 Mar 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/This is an estimate/))
    expect(screen.getByText('300 kWh over 30 days (estimate)')).toBeInTheDocument()
    await submit()
    expect(await screen.findByText('Reading recorded.')).toBeInTheDocument()
    expect(m.recordReading).toHaveBeenCalledWith({
      meterId: 'm1',
      readingDate: '2026-03-31',
      readingValue: 1890,
      isEstimate: true,
      method: 'manual',
      notes: null,
    })
  })

  it('refuses a reading below the previous one before it is sent', async () => {
    m.getReadingsAround.mockResolvedValue(ok(around))
    open('/readings/new?meter=m1')
    await enter('2026-03-31', '1500')
    expect(
      await screen.findByText('This is below the previous reading of 1,590 kWh.'),
    ).toBeInTheDocument()
    await submit()
    expect(m.recordReading).not.toHaveBeenCalled()
  })

  it('asks for confirmation of an unusual reading, and again if it changes', async () => {
    m.getReadingsAround.mockResolvedValue(ok(around))
    m.recordReading.mockResolvedValue(ok({ id: 'r9', flag: 'high' }))
    open('/readings/new?meter=m1')
    await enter('2026-03-31', '3000')
    expect(await screen.findByText('Unusually high for this meter')).toBeInTheDocument()
    await submit()
    expect(await screen.findByText(/Check the meter again/)).toBeInTheDocument()
    expect(m.recordReading).not.toHaveBeenCalled()

    const confirm = () => screen.getByLabelText(/I have checked the meter/)
    await userEvent.click(confirm())
    await userEvent.type(screen.getByLabelText('Current reading (kWh)'), '0')
    expect(confirm()).not.toBeChecked()
    await userEvent.click(confirm())
    await submit()
    expect(
      await screen.findByText('Reading recorded and flagged as unusually high.'),
    ).toBeInTheDocument()
  })

  it('cannot be submitted until the previous readings have loaded', async () => {
    let finish!: () => void
    m.getReadingsAround.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(ok(around))
      }),
    )
    open('/readings/new?meter=m1')
    const button = await screen.findByRole('button', { name: 'Submit Reading' })
    expect(button).toBeDisabled()
    finish()
    await waitFor(() => expect(button).toBeEnabled())
  })

  it('shows the database’s refusal on the field', async () => {
    m.recordReading.mockResolvedValue(
      err({
        code: 'conflict',
        field: 'readingDate',
        message: 'This meter already has a reading on this date.',
      }),
    )
    open('/readings/new?meter=m1')
    const input = await screen.findByLabelText('Current reading (kWh)')
    expect(screen.getByLabelText('Reading date')).toHaveValue(businessToday())
    await userEvent.type(input, '2000')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Submit Reading' })).toBeEnabled(),
    )
    await submit()
    expect(
      await screen.findByText('This meter already has a reading on this date.'),
    ).toBeInTheDocument()
    expect(input).toHaveValue('2000')
  })

  it('needs a meter and a valid number', async () => {
    open('/readings/new')
    await userEvent.type(await screen.findByLabelText('Current reading (kWh)'), '1,500')
    await submit()
    expect(screen.getByText('Choose the meter.')).toBeInTheDocument()
    expect(screen.getByText(/no commas/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /MTR-0001/ }))
    expect(screen.queryByText('Choose the meter.')).toBeNull()
  })

  it('does not offer a retired meter', async () => {
    m.getMeter.mockResolvedValue(ok(meterFixture({ status: 'replaced', retiredOn: '2026-11-01' })))
    open('/readings/new?meter=m1')
    expect(await screen.findByRole('alert')).toHaveTextContent('MTR-0001 is no longer in service')
    expect(screen.queryByLabelText('Current reading (kWh)')).toBeNull()
  })
})

describe('meter details', () => {
  it('shows history with estimates and flags labelled', async () => {
    m.getReadings.mockResolvedValue(
      ok({
        rows: [
          readingFixture({ isEstimate: true, consumptionIsEstimate: true, flag: 'low' }),
          readingFixture({ id: 'r0', readingDate: '2026-10-01', consumption: null, days: null }),
        ],
        total: 2,
      }),
    )
    open('/m1')
    const history = await screen.findByRole('region', { name: 'Reading history' })
    expect(await within(history).findByText('250.5 kWh')).toBeInTheDocument()
    // Both the reading and the consumption it produces are marked.
    expect(within(history).getAllByText('Estimate')).toHaveLength(2)
    expect(within(history).getByText('Unusually low')).toBeInTheDocument()
  })

  it('lets a manager remove a reading after confirming, and staff not at all', async () => {
    const { unmount } = open('/m1', 'staff')
    await screen.findByText('250.5 kWh')
    expect(screen.queryByRole('button', { name: /Remove reading/ })).toBeNull()
    unmount()

    m.deleteReading.mockResolvedValue(ok(undefined))
    open('/m1', 'manager')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove reading of 1 Nov 2026' }),
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('14,850.5 kWh on 1 Nov 2026')
    expect(m.deleteReading).not.toHaveBeenCalled()
    const before = m.getMeterConsumption.mock.calls.length
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove reading' }))
    expect(await screen.findByText('Reading removed.')).toBeInTheDocument()
    expect(m.deleteReading).toHaveBeenCalledWith('r1')
    await waitFor(() => expect(m.getMeterConsumption.mock.calls.length).toBeGreaterThan(before))
  })

  it('replaces a meter and opens the new one', async () => {
    m.retireMeter.mockResolvedValue(ok({ newMeterId: 'm2' }))
    open('/m1')
    await userEvent.click(await screen.findByRole('button', { name: /Replace or decommission/ }))
    const dialog = screen.getByRole('dialog')
    // Typing whole words also proves the dialog does not steal focus on each keystroke.
    await userEvent.type(within(dialog).getByLabelText('New serial number'), 'MTR-0200')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Faulty display')
    await userEvent.type(within(dialog).getByLabelText('Final reading (kWh)'), '15000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace meter' }))
    expect(await screen.findByText('This meter replaces MTR-0001.')).toBeInTheDocument()
    expect(m.retireMeter).toHaveBeenCalledWith('m1', {
      retiredOn: businessToday(),
      reason: 'Faulty display',
      finalReading: 15000,
      newSerialNumber: 'MTR-0200',
      newInitialReading: 0,
    })
    expect(m.getMeter).toHaveBeenLastCalledWith('m2')
  })

  it('shows a low final reading on that field', async () => {
    m.retireMeter.mockResolvedValue(
      err({
        code: 'validation',
        field: 'readingValue',
        message: 'This is below the previous reading.',
      }),
    )
    open('/m1')
    await userEvent.click(await screen.findByRole('button', { name: /Replace or decommission/ }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Decommission'))
    expect(within(dialog).queryByLabelText('New serial number')).toBeNull()
    await userEvent.type(within(dialog).getByLabelText('Final reading (kWh)'), '1')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Demolished')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decommission meter' }))
    expect(
      await within(dialog).findByText('This is below the previous reading.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Final reading (kWh)')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('links a replaced meter to its replacement and offers no more readings', async () => {
    m.getMeter.mockResolvedValue(
      ok(
        meterFixture({
          status: 'replaced',
          retiredOn: '2026-11-22',
          retiredReason: 'Faulty',
          replacedById: 'm2',
        }),
      ),
    )
    open('/m1')
    expect(await screen.findByRole('link', { name: 'View the replacement meter' })).toHaveAttribute(
      'href',
      '/electricity-meters/m2',
    )
    expect(screen.queryByRole('link', { name: /Record Reading/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Replace or decommission/ })).toBeNull()
  })

  it('schedules maintenance and refreshes the list', async () => {
    w.createMaintenance.mockResolvedValue(ok({ id: 'w1' }))
    // A reload brings a new object, as a real fetch does.
    m.getMeter.mockImplementation(() => Promise.resolve(ok(meterFixture())))
    open('/m1')
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Issue or task'), 'Seal check')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create work order' }))
    expect(within(dialog).getByText('Scheduled work needs a date.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Scheduled date'), '2026-12-01')
    const before = w.getMeterMaintenance.mock.calls.length
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create work order' }))
    expect(await screen.findByText('Maintenance saved.')).toBeInTheDocument()
    expect(w.createMaintenance.mock.calls[0]).toMatchObject([
      'm1',
      { issue: 'Seal check', scheduledFor: '2026-12-01', status: 'scheduled' },
    ])
    await waitFor(() => expect(w.getMeterMaintenance.mock.calls.length).toBeGreaterThan(before))
  })

  it('hides maintenance and actions from clients', async () => {
    open('/m1', 'client')
    await screen.findByText('250.5 kWh')
    expect(screen.queryByRole('region', { name: 'Maintenance history' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Cleo Client' })).toBeNull()
    expect(w.getMeterMaintenance).not.toHaveBeenCalled()
  })

  it('shows not found', async () => {
    m.getMeter.mockResolvedValue(
      err({ code: 'not_found', message: 'This meter could not be found.' }),
    )
    open('/nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be found')
  })
})

describe('maintenance', () => {
  it('shows open work by priority, with overdue marked', async () => {
    open('/maintenance')
    const row = (await screen.findByRole('button', { name: 'MNT-00007' })).closest('tr')!
    for (const text of ['MTR-0001', 'Thabo Mokoena', 'Overdue', 'Urgent', 'Scheduled'])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(w.listMaintenance.mock.calls[0]).toMatchObject([
      { sort: 'priority_rank', ascending: true },
      { priority: '', status: 'open' },
    ])
    expect(await screen.findByText('1 overdue')).toBeInTheDocument()
  })

  it('requires an outcome to complete work, then refreshes', async () => {
    w.updateMaintenance.mockResolvedValue(ok({ id: 'w1' }))
    open('/maintenance')
    await userEvent.click(await screen.findByRole('button', { name: 'MNT-00007' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'completed')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(within(dialog).getByText(/Say what was done/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Outcome'), 'Seal replaced')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Work order updated.')).toBeInTheDocument()
    expect(w.updateMaintenance.mock.calls[0]).toMatchObject([
      'w1',
      { status: 'completed', outcome: 'Seal replaced', assignedTo: 'u9' },
    ])
    await waitFor(() => expect(w.getMaintenanceCounts).toHaveBeenCalledTimes(2))
  })

  it('keeps a technician who has left the team selected on their work order', async () => {
    w.listStaffOptions.mockResolvedValue(ok([]))
    open('/maintenance')
    await userEvent.click(await screen.findByRole('button', { name: 'MNT-00007' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Technician')).toHaveValue('u9')
  })
})
