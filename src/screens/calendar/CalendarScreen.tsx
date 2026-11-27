import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { EventDialog, ItemDialog } from '@/components/calendar/CalendarDialogs'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getCalendarConnection, loadCalendar } from '@/services/calendar'
import { callbackNotice, disconnectIntegration, startOAuth } from '@/services/integrations'
import {
  SOURCE_LABEL,
  type CalendarData,
  type CalendarItem,
  type CalendarSource,
} from '@/types/calendar'
import { navigation } from '@/utils/browser'
import {
  addDays,
  addMonths,
  dayLabel,
  daysOf,
  monthGrid,
  monthLabel,
  monthStart,
  saDate,
  saTime,
  shortDayLabel,
  timeRange,
  toInstant,
} from '@/utils/calendar'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const COLOUR: Record<CalendarSource, string> = {
  event: 'bg-primary-container text-on-primary-container',
  task: 'bg-tertiary-container text-on-tertiary-container',
  maintenance: 'bg-secondary-container text-on-secondary-container',
  invoice: 'bg-error-container text-on-error-container',
  google: 'border border-outline-variant bg-surface text-on-surface',
}

const startsSmall = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 639px)').matches

/**
 * The calendar: Umbane appointments, task due dates, scheduled maintenance and invoice due dates,
 * with the person's own Google Calendar events beside them when they have connected it. Times are
 * South African time.
 */
export default function CalendarScreen() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const today = saDate(new Date())
  const [cursor, setCursor] = useState(today)
  const [view, setView] = useState<'month' | 'agenda'>(() => (startsSmall() ? 'agenda' : 'month'))
  const [selectedDay, setSelectedDay] = useState(today)
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState(() => callbackNotice(params, () => 'Google Calendar'))
  const [opened, setOpened] = useState<CalendarItem | null>(null)
  const [editing, setEditing] = useState<{ item: CalendarItem | null; date: string } | null>(() =>
    params.get('new') ? { item: null, date: today } : null,
  )

  const grid = useMemo(() => monthGrid(cursor), [cursor])
  const from = toInstant(grid[0])
  const to = toInstant(addDays(grid[grid.length - 1], 1))
  const state = useResource(() => loadCalendar(from, to), `calendar-${from}-${version}`)
  const connection = useResource(
    () => getCalendarConnection(profile?.id ?? ''),
    `calendar-connection-${profile?.id}-${version}`,
  )

  const changed = (text: string) => {
    setNotice({ tone: 'success', text })
    setOpened(null)
    setEditing(null)
    setVersion((v) => v + 1)
  }

  function closeEditor() {
    setEditing(null)
    if (params.get('new')) {
      params.delete('new')
      setParams(params, { replace: true })
    }
  }

  async function connectGoogle() {
    const r = await startOAuth('google_calendar')
    if (r.ok) navigation.go(r.data.url)
    else setNotice({ tone: 'error', text: r.error.message })
  }

  async function disconnectGoogle(id: string) {
    const r = await disconnectIntegration(id)
    if (r.ok) changed('Google Calendar disconnected. Its events no longer show here.')
    else setNotice({ tone: 'error', text: r.error.message })
  }

  const googleConnected = Boolean(state.data?.google.connected)

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Appointments, tasks, maintenance and invoice due dates, in South African time."
        actions={
          <Button onClick={() => setEditing({ item: null, date: selectedDay })}>
            <CalendarPlus size={16} aria-hidden="true" /> New Event
          </Button>
        }
      />
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-md px-4 py-3 text-body-md ${notice.tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface'}`}
        >
          {notice.text}
        </p>
      )}

      <section
        aria-label="Google Calendar"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface p-4 shadow-card"
      >
        {connection.data ? (
          <>
            <p className="text-body-md text-on-surface">
              {connection.data.status === 'connected' ? (
                <>
                  Showing your Google Calendar
                  {connection.data.account ? ` (${connection.data.account})` : ''}.
                  {state.data?.google.error && (
                    <span className="block text-label-md text-error">
                      {state.data.google.error}
                    </span>
                  )}
                </>
              ) : (
                <>
                  Google Calendar needs to be connected again.
                  {connection.data.error && (
                    <span className="block text-label-md text-error">{connection.data.error}</span>
                  )}
                </>
              )}
            </p>
            <div className="flex gap-2">
              {connection.data.status !== 'connected' && (
                <Button onClick={() => void connectGoogle()}>Reconnect Google Calendar</Button>
              )}
              <Button
                variant="secondary"
                onClick={() => void disconnectGoogle(connection.data!.id)}
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-body-md text-on-surface">
              Connect your own Google Calendar to see your events here and copy Umbane appointments
              to it.
            </p>
            <Button variant="secondary" onClick={() => void connectGoogle()}>
              Connect Google Calendar
            </Button>
          </>
        )}
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-label="Previous month"
          onClick={() => setCursor((c) => addMonths(c, -1))}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setCursor(today)
            setSelectedDay(today)
          }}
        >
          Today
        </Button>
        <Button
          variant="secondary"
          aria-label="Next month"
          onClick={() => setCursor((c) => addMonths(c, 1))}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
        <h2 aria-live="polite" className="ml-2 text-title-md font-semibold text-on-surface">
          {monthLabel(monthStart(cursor))}
        </h2>
        <div
          role="group"
          aria-label="View"
          className="ml-auto inline-flex overflow-hidden rounded-md border border-outline-variant"
        >
          {(['month', 'agenda'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`px-3 py-2 text-label-md font-semibold ${view === v ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface hover:bg-surface-container'}`}
            >
              {v === 'month' ? 'Month' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>
      <ul aria-label="Colour key" className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(SOURCE_LABEL) as CalendarSource[])
          .filter((s) => s !== 'google' || googleConnected)
          .map((s) => (
            <li key={s} className={`rounded px-2 py-0.5 text-label-sm ${COLOUR[s]}`}>
              {SOURCE_LABEL[s]}
            </li>
          ))}
      </ul>

      <ResourceBoundary state={state} skeletonLines={8}>
        {(data) =>
          view === 'month' ? (
            <Month
              data={data}
              grid={grid}
              cursor={cursor}
              today={today}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onOpen={setOpened}
            />
          ) : (
            <Agenda
              data={data}
              days={grid.filter((d) => d.slice(0, 7) === cursor.slice(0, 7))}
              today={today}
              onOpen={setOpened}
            />
          )
        }
      </ResourceBoundary>

      {opened && (
        <ItemDialog
          item={opened}
          googleConnected={googleConnected}
          onClose={() => setOpened(null)}
          onEdit={() => {
            setEditing({ item: opened, date: saDate(opened.startsAt) })
            setOpened(null)
          }}
          onChanged={changed}
        />
      )}
      {editing && (
        <EventDialog
          item={editing.item}
          initialDate={editing.date}
          googleConnected={googleConnected}
          onClose={closeEditor}
          onDone={(text) => {
            closeEditor()
            changed(text)
          }}
        />
      )}
    </>
  )
}

const itemsByDay = (items: CalendarItem[]) => {
  const map = new Map<string, CalendarItem[]>()
  for (const item of items) {
    for (const d of daysOf(item)) map.set(d, [...(map.get(d) ?? []), item])
  }
  return map
}

function ItemButton({
  item,
  compact,
  onOpen,
}: {
  item: CalendarItem
  compact?: boolean
  onOpen: (i: CalendarItem) => void
}) {
  const when = item.allDay ? 'all day' : saTime(item.startsAt)
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${SOURCE_LABEL[item.source]}: ${item.title}, ${when}`}
      className={`block w-full truncate rounded px-1.5 py-0.5 text-left ${compact ? 'text-label-sm' : 'text-body-md'} ${COLOUR[item.source]}`}
    >
      {!item.allDay && <span className="mr-1 tabular-nums">{saTime(item.startsAt)}</span>}
      {item.title}
    </button>
  )
}

function Month({
  data,
  grid,
  cursor,
  today,
  selectedDay,
  onSelectDay,
  onOpen,
}: {
  data: CalendarData
  grid: string[]
  cursor: string
  today: string
  selectedDay: string
  onSelectDay: (d: string) => void
  onOpen: (i: CalendarItem) => void
}) {
  const byDay = itemsByDay(data.items)
  const weeks = Array.from({ length: 6 }, (_, w) => grid.slice(w * 7, w * 7 + 7))
  const dayItems = byDay.get(selectedDay) ?? []
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-card">
        <table
          className="w-full table-fixed border-collapse"
          aria-label={monthLabel(monthStart(cursor))}
        >
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="border-b border-outline-variant py-2 text-label-md font-semibold text-on-surface-variant"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  const items = byDay.get(day) ?? []
                  const inMonth = day.slice(0, 7) === cursor.slice(0, 7)
                  return (
                    <td
                      key={day}
                      className={`h-24 border border-outline-variant p-1 align-top sm:h-28 ${inMonth ? '' : 'bg-surface-container-low'} ${day === selectedDay ? 'ring-2 ring-inset ring-primary' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectDay(day)}
                        aria-label={`${dayLabel(day)}${items.length ? `, ${items.length} ${items.length === 1 ? 'item' : 'items'}` : ''}`}
                        aria-pressed={day === selectedDay}
                        className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-label-md ${day === today ? 'bg-primary font-bold text-on-primary' : inMonth ? 'text-on-surface' : 'text-on-surface-variant'}`}
                      >
                        {Number(day.slice(8))}
                      </button>
                      <div className="hidden flex-col gap-0.5 md:flex">
                        {items.slice(0, 3).map((i) => (
                          <ItemButton key={i.key} item={i} compact onOpen={onOpen} />
                        ))}
                        {items.length > 3 && (
                          <button
                            type="button"
                            onClick={() => onSelectDay(day)}
                            className="text-left text-label-sm font-semibold text-secondary"
                          >
                            {items.length - 3} more
                          </button>
                        )}
                      </div>
                      {items.length > 0 && (
                        <span aria-hidden="true" className="flex flex-wrap gap-0.5 md:hidden">
                          {items.slice(0, 4).map((i) => (
                            <span
                              key={i.key}
                              className={`h-1.5 w-1.5 rounded-full ${COLOUR[i.source].split(' ')[0]}`}
                            />
                          ))}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section
        aria-labelledby="day-heading"
        className="mt-4 rounded-lg border border-outline-variant bg-surface p-4 shadow-card"
      >
        <h3 id="day-heading" className="mb-2 text-title-sm font-semibold text-on-surface">
          {dayLabel(selectedDay)}
        </h3>
        {dayItems.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">Nothing scheduled.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dayItems.map((i) => (
              <li key={i.key} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-label-md tabular-nums text-on-surface-variant">
                  {timeRange(i)}
                </span>
                <div className="min-w-0 flex-1">
                  <ItemButton item={i} onOpen={onOpen} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function Agenda({
  data,
  days,
  today,
  onOpen,
}: {
  data: CalendarData
  days: string[]
  today: string
  onOpen: (i: CalendarItem) => void
}) {
  const byDay = itemsByDay(data.items)
  const withItems = days.filter((d) => (byDay.get(d) ?? []).length > 0)
  if (withItems.length === 0) {
    return (
      <p className="rounded-lg border border-outline-variant bg-surface p-4 text-body-md text-on-surface-variant">
        Nothing scheduled this month.
      </p>
    )
  }
  return (
    <ol aria-label="Agenda" className="flex flex-col gap-3">
      {withItems.map((d) => (
        <li key={d} className="rounded-lg border border-outline-variant bg-surface p-4 shadow-card">
          <h3 className="mb-2 text-title-sm font-semibold text-on-surface">
            {shortDayLabel(d)}
            {d === today && <span className="ml-2 text-label-md text-primary">Today</span>}
          </h3>
          <ul className="flex flex-col gap-1">
            {(byDay.get(d) ?? []).map((i) => (
              <li key={i.key} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-label-md tabular-nums text-on-surface-variant">
                  {timeRange(i)}
                </span>
                <div className="min-w-0 flex-1">
                  <ItemButton item={i} onOpen={onOpen} />
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
