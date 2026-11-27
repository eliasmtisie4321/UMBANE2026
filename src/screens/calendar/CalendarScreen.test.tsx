import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as calendarService from '@/services/calendar'
import * as integrationService from '@/services/integrations'
import * as notificationService from '@/services/notifications'
import * as shareService from '@/services/share'
import type { UserRole } from '@/types/auth'
import type { CalendarItem } from '@/types/calendar'
import { navigation } from '@/utils/browser'
import { saDate, toInstant } from '@/utils/calendar'
import { ok } from '@/utils/result'

vi.mock('@/services/calendar')
vi.mock('@/services/notifications')
vi.mock('@/services/integrations', async (real) => ({
  ...(await real<typeof import('@/services/integrations')>()),
  startOAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
}))
vi.mock('@/services/share', async (real) => ({
  ...(await real<typeof import('@/services/share')>()),
  listTeamRecipients: vi.fn(),
}))

const cal = vi.mocked(calendarService)
const integ = vi.mocked(integrationService)
const today = saDate(new Date())

const item = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  key: 'event:e1',
  source: 'event',
  id: 'e1',
  title: 'Site visit: Karoo Office',
  startsAt: toInstant(today, '09:00'),
  endsAt: toInstant(today, '10:30'),
  allDay: false,
  kind: 'site_visit',
  link: '/calendar',
  detail: null,
  assignedTo: 'u1',
  assignedName: 'Test User',
  ownerId: 'u1',
  customerId: 'c2',
  customerName: 'Thabo Mokoena',
  location: 'Beaufort West',
  description: null,
  googleEventId: null,
  googleCalendarOwner: null,
  googleHtmlLink: null,
  googleError: null,
  ...over,
})

function setup({
  google = false,
  items = [item()],
}: { google?: boolean; items?: CalendarItem[] } = {}) {
  cal.loadCalendar.mockResolvedValue(
    ok({
      items,
      google: { connected: google, account: google ? 'test@gmail.test' : null, error: null },
    }),
  )
  cal.getCalendarConnection.mockResolvedValue(
    ok(
      google
        ? { id: 'int-cal', status: 'connected', account: 'test@gmail.test', error: null }
        : null,
    ),
  )
}
const open = (role: UserRole = 'staff', route = '/calendar') =>
  renderAt(<App />, signedInAs(role), route)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  vi.mocked(shareService.listTeamRecipients).mockResolvedValue(
    ok([{ id: 'u1', name: 'Test User', email: 'test@umbane.test', phone: null }]),
  )
})

describe('the calendar', () => {
  it('shows the month with what is on each day, and the day’s list', async () => {
    setup({
      items: [
        item(),
        item({
          key: 'task:t1',
          source: 'task',
          id: 't1',
          title: 'Replace a meter battery',
          allDay: true,
          startsAt: toInstant(today),
          endsAt: toInstant(today),
          link: '/tasks/t1',
          ownerId: null,
        }),
      ],
    })
    open()
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Google Calendar' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /Appointment: Site visit: Karoo Office, 09:00/ })
        .length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', { name: /Task due: Replace a meter battery, all day/ }).length,
    ).toBeGreaterThan(0)
  })

  it('opens an event with its details, and lets its organiser delete it', async () => {
    setup()
    cal.deleteCalendarEvent.mockResolvedValue(ok({ googleCopyLeft: false }))
    open()
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /Appointment: Site visit/ }))[0],
    )
    const dialog = screen.getByRole('dialog', { name: 'Site visit: Karoo Office' })
    expect(within(dialog).getByRole('link', { name: 'Thabo Mokoena' })).toHaveAttribute(
      'href',
      '/customers/c2',
    )
    expect(within(dialog).getByText('Beaufort West')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Event' }))
    expect(cal.deleteCalendarEvent).toHaveBeenCalledWith('e1')
    expect(await screen.findByText('Event deleted.')).toBeInTheDocument()
  })

  it('does not let staff change someone else’s event', async () => {
    setup({ items: [item({ ownerId: 'someone', assignedTo: 'someone' })] })
    open('staff')
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /Appointment: Site visit/ }))[0],
    )
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('adds an event in South African time, and copies it to Google Calendar when connected', async () => {
    setup({ google: true, items: [] })
    cal.createCalendarEvent.mockResolvedValue(ok({ id: 'e9' }))
    cal.syncToGoogle.mockResolvedValue(ok({ htmlLink: 'https://calendar.google.com/e/9' }))
    open('staff')
    await userEvent.click(await screen.findByRole('button', { name: /New Event/ }))
    const dialog = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Meter installation')
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'installation')
    const date = within(dialog).getByLabelText('Date')
    await userEvent.clear(date)
    await userEvent.type(date, '2026-12-03')
    const start = within(dialog).getByLabelText('Starts')
    await userEvent.clear(start)
    await userEvent.type(start, '13:30')
    const end = within(dialog).getByLabelText('Ends')
    await userEvent.clear(end)
    await userEvent.type(end, '15:00')
    expect(within(dialog).getByLabelText('Add to my Google Calendar')).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Event' }))
    expect(cal.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Meter installation',
        kind: 'installation',
        startsAt: '2026-12-03T11:30:00.000Z',
        endsAt: '2026-12-03T13:00:00.000Z',
        allDay: false,
        assignedTo: 'u1',
      }),
    )
    expect(cal.syncToGoogle).toHaveBeenCalledWith('e9')
    expect(
      await screen.findByText('Event added. It is in your Google Calendar too.'),
    ).toBeInTheDocument()
  })

  it('checks the times before saving', async () => {
    setup({ items: [] })
    open('staff')
    await userEvent.click(await screen.findByRole('button', { name: /New Event/ }))
    const dialog = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Backwards')
    const end = within(dialog).getByLabelText('Ends')
    await userEvent.clear(end)
    await userEvent.type(end, '08:00')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Event' }))
    expect(within(dialog).getByText('It must end after it starts.')).toBeInTheDocument()
    expect(cal.createCalendarEvent).not.toHaveBeenCalled()
  })

  it('opens the new-event form from Quick Add', async () => {
    setup({ items: [] })
    open('staff', '/calendar?new=1')
    expect(await screen.findByRole('dialog', { name: 'New event' })).toBeInTheDocument()
  })

  it('lists the month in the agenda view', async () => {
    setup()
    open('staff')
    await userEvent.click(await screen.findByRole('button', { name: 'Agenda' }))
    expect(screen.getByRole('list', { name: 'Agenda' })).toHaveTextContent(
      'Site visit: Karoo Office',
    )
  })
})

describe('Google Calendar on the calendar page', () => {
  it('connects a person’s own Google Calendar', async () => {
    setup()
    const go = vi.spyOn(navigation, 'go').mockImplementation(() => undefined)
    integ.startOAuth.mockResolvedValue(
      ok({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }),
    )
    open('staff')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }))
    expect(integ.startOAuth).toHaveBeenCalledWith('google_calendar')
    expect(go).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
  })

  it('shows Google events beside Umbane’s, and disconnects', async () => {
    setup({
      google: true,
      items: [
        item(),
        item({
          key: 'google:g1',
          source: 'google',
          id: 'g1',
          title: 'Dentist',
          ownerId: null,
          googleHtmlLink: 'https://calendar.google.com/e/g1',
          customerId: null,
          customerName: null,
          location: null,
        }),
      ],
    })
    integ.disconnectIntegration.mockResolvedValue(ok({ disconnected: true }))
    open('staff')
    expect(
      await screen.findByText(/Showing your Google Calendar \(test@gmail.test\)/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /Google Calendar: Dentist/ })[0])
    expect(screen.getByRole('link', { name: /Open in Google Calendar/ })).toHaveAttribute(
      'href',
      'https://calendar.google.com/e/g1',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(integ.disconnectIntegration).toHaveBeenCalledWith('int-cal')
    expect(await screen.findByText(/Google Calendar disconnected/)).toBeInTheDocument()
  })

  it('says it is connected when Google sends the person back', async () => {
    setup()
    open('staff', '/calendar?connected=google_calendar')
    expect(await screen.findByText('Google Calendar is connected.')).toBeInTheDocument()
  })

  it('is not for clients', async () => {
    setup()
    open('client')
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument()
  })
})
