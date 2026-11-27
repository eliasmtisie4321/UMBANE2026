import { ExternalLink } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { FormError } from '@/components/data/ListPanel'
import { Badge, Button, Input, Modal, Select, Textarea } from '@/components/ui'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  removeFromGoogle,
  syncToGoogle,
  updateCalendarEvent,
} from '@/services/calendar'
import { searchEverything, type SearchResult } from '@/services/search'
import { listTeamRecipients, type TeamRecipient } from '@/services/share'
import { EVENT_KINDS, SOURCE_LABEL, type CalendarItem, type EventKind } from '@/types/calendar'
import { addDays, dayLabel, saDate, saTime, timeRange, toInstant } from '@/utils/calendar'

const isManager = (role?: string) => role === 'administrator' || role === 'manager'

/** Who may change an event: its organiser, the person it is for, or a manager (as the database). */
function canChange(item: CalendarItem, me: { id: string; role: string } | null) {
  return (
    item.source === 'event' &&
    Boolean(me) &&
    (item.ownerId === me!.id || item.assignedTo === me!.id || isManager(me!.role))
  )
}

/** What a calendar item is, and what can be done with it. */
export function ItemDialog({
  item,
  googleConnected,
  onClose,
  onEdit,
  onChanged,
}: {
  item: CalendarItem
  googleConnected: boolean
  onClose: () => void
  onEdit: () => void
  onChanged: (notice: string) => void
}) {
  const { profile } = useAuth()
  const me = profile ? { id: profile.id, role: profile.role } : null
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const editable = canChange(item, me)

  async function run(
    what: string,
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    notice: string,
  ) {
    setBusy(what)
    setError(null)
    const r = await action()
    setBusy(null)
    if (r.ok) onChanged(notice)
    else setError(r.error?.message ?? 'Something went wrong.')
  }

  async function remove() {
    setBusy('delete')
    setError(null)
    const r = await deleteCalendarEvent(item.id)
    setBusy(null)
    if (!r.ok) return setError(r.error.message)
    onChanged(
      r.data.googleCopyLeft
        ? 'Event deleted. Its copy in Google Calendar could not be removed: delete it there.'
        : 'Event deleted.',
    )
  }

  const day = saDate(item.startsAt)
  return (
    <Modal open title={item.title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error && <FormError>{error}</FormError>}
        <p className="flex flex-wrap items-center gap-2 text-body-md text-on-surface">
          <Badge tone={item.source === 'google' ? 'neutral' : 'info'}>
            {SOURCE_LABEL[item.source]}
          </Badge>
          {item.source === 'event' && item.kind && (
            <span className="text-label-md text-on-surface-variant">
              {EVENT_KINDS.find((k) => k.value === item.kind)?.label}
            </span>
          )}
        </p>
        <p className="text-body-md text-on-surface">
          {dayLabel(day)} · {timeRange(item)}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-md">
          {item.customerName && (
            <>
              <dt className="text-on-surface-variant">Customer</dt>
              <dd>
                {item.customerId ? (
                  <Link to={`/customers/${item.customerId}`} className="text-primary underline">
                    {item.customerName}
                  </Link>
                ) : (
                  item.customerName
                )}
              </dd>
            </>
          )}
          {item.assignedName && (
            <>
              <dt className="text-on-surface-variant">For</dt>
              <dd>{item.assignedName}</dd>
            </>
          )}
          {item.location && (
            <>
              <dt className="text-on-surface-variant">Where</dt>
              <dd>{item.location}</dd>
            </>
          )}
          {item.detail && item.source !== 'event' && (
            <>
              <dt className="text-on-surface-variant">Reference</dt>
              <dd>{item.detail}</dd>
            </>
          )}
        </dl>
        {item.description && (
          <p className="whitespace-pre-wrap text-body-md text-on-surface">{item.description}</p>
        )}

        {item.source === 'event' && (
          <div className="rounded-md bg-surface-container-low p-3 text-body-md">
            {item.googleEventId ? (
              <p className="flex flex-wrap items-center gap-2">
                <span>In Google Calendar.</span>
                {item.googleHtmlLink && (
                  <a
                    href={item.googleHtmlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline"
                  >
                    Open it there <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </p>
            ) : (
              <p className="text-on-surface-variant">Not in Google Calendar.</p>
            )}
            {item.googleError && (
              <p className="mt-1 text-label-md text-error">Last copy failed: {item.googleError}</p>
            )}
            {editable && (
              <div className="mt-2 flex flex-wrap gap-2">
                {!item.googleEventId && googleConnected && (
                  <Button
                    variant="secondary"
                    loading={busy === 'push'}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        'push',
                        () => syncToGoogle(item.id),
                        'Added to your Google Calendar.',
                      )
                    }
                  >
                    Add to My Google Calendar
                  </Button>
                )}
                {item.googleEventId && (
                  <Button
                    variant="secondary"
                    loading={busy === 'unpush'}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        'unpush',
                        () => removeFromGoogle(item.id),
                        'Removed from Google Calendar.',
                      )
                    }
                  >
                    Remove from Google Calendar
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {confirming ? (
          <div
            role="alertdialog"
            aria-label="Delete this event?"
            className="rounded-md border border-error p-3"
          >
            <p className="text-body-md text-on-surface">
              Delete this event?{item.googleEventId ? ' Its copy in Google Calendar goes too.' : ''}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
              >
                Keep It
              </Button>
              <Button variant="danger" loading={busy === 'delete'} onClick={() => void remove()}>
                Delete Event
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {item.source === 'google' && item.googleHtmlLink && (
              <a
                href={item.googleHtmlLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant px-4 py-2.5 text-label-md font-semibold text-primary"
              >
                Open in Google Calendar <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            {item.source !== 'event' && item.source !== 'google' && item.link && (
              <Link
                to={item.link}
                className="inline-flex items-center rounded-md border border-outline-variant px-4 py-2.5 text-label-md font-semibold text-primary"
              >
                Open {SOURCE_LABEL[item.source].replace(' due', '').toLowerCase()}
              </Link>
            )}
            {editable && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setConfirming(true)}
                  disabled={busy !== null}
                >
                  Delete
                </Button>
                <Button variant="secondary" onClick={onEdit} disabled={busy !== null}>
                  Edit
                </Button>
              </>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Finds a customer as you type, using the same search as the top bar. */
function CustomerPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null
  onChange: (c: { id: string; name: string } | null) => void
}) {
  const [text, setText] = useState('')
  // Matches for the text they answer: older answers are never shown.
  const [answer, setAnswer] = useState<{ query: string; found: SearchResult[] } | null>(null)
  const query = text.trim()
  useEffect(() => {
    if (query.length < 2) return
    let stale = false
    const timer = window.setTimeout(async () => {
      const r = await searchEverything(query)
      if (!stale && r.ok) setAnswer({ query, found: r.data.filter((x) => x.kind === 'customer') })
    }, 250)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [query])
  const found = query.length >= 2 && answer?.query === query ? answer.found : []
  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label-md font-semibold text-on-surface">Customer</span>
        <p className="flex items-center justify-between gap-2 rounded-md border border-outline-variant px-3 py-2 text-body-md">
          {value.name}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-label-md text-primary underline"
            aria-label={`Remove ${value.name}`}
          >
            Change
          </button>
        </p>
      </div>
    )
  }
  return (
    <div>
      <Input
        id="event-customer"
        label="Customer (optional)"
        placeholder="Type a name"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      {found.length > 0 && (
        <ul
          aria-label="Matching customers"
          className="mt-1 rounded-md border border-outline-variant"
        >
          {found.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChange({ id: c.id, name: c.title })}
                className="w-full px-3 py-2 text-left text-body-md hover:bg-surface-container"
              >
                {c.title}
                {c.subtitle && (
                  <span className="block text-label-sm text-on-surface-variant">{c.subtitle}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface FormValues {
  title: string
  kind: EventKind
  date: string
  start: string
  end: string
  endDate: string
  allDay: boolean
  location: string
  description: string
  assignedTo: string
}

/** New or changed appointment. Times are South African time. */
export function EventDialog({
  item,
  initialDate,
  googleConnected,
  onClose,
  onDone,
}: {
  item: CalendarItem | null
  initialDate: string
  googleConnected: boolean
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const { profile } = useAuth()
  const [team, setTeam] = useState<TeamRecipient[]>([])
  const [values, setValues] = useState<FormValues>(() =>
    item
      ? {
          title: item.title,
          kind: (item.kind as EventKind) ?? 'appointment',
          date: saDate(item.startsAt),
          start: saTime(item.startsAt),
          end: saTime(item.endsAt),
          endDate: item.allDay ? addDays(saDate(item.endsAt), -1) : saDate(item.endsAt),
          allDay: item.allDay,
          location: item.location ?? '',
          description: item.description ?? '',
          assignedTo: item.assignedTo ?? '',
        }
      : {
          title: '',
          kind: 'appointment',
          date: initialDate,
          start: '09:00',
          end: '10:00',
          endDate: initialDate,
          allDay: false,
          location: '',
          description: '',
          assignedTo: profile?.id ?? '',
        },
  )
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    item?.customerId && item.customerName ? { id: item.customerId, name: item.customerName } : null,
  )
  const [toGoogle, setToGoogle] = useState(Boolean(item ? item.googleEventId : googleConnected))
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void listTeamRecipients().then((r) => live && r.ok && setTeam(r.data))
    return () => {
      live = false
    }
  }, [])

  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) =>
    setValues((x) => ({ ...x, [k]: v }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found: Partial<Record<keyof FormValues, string>> = {}
    if (values.title.trim().length < 2) found.title = 'Give the event a title.'
    if (!values.date) found.date = 'Choose a date.'
    const startsAt = values.allDay
      ? toInstant(values.date)
      : toInstant(values.date, values.start || '00:00')
    const endsAt = values.allDay
      ? toInstant(addDays(values.endDate || values.date, 1))
      : toInstant(
          values.endDate && values.endDate > values.date ? values.endDate : values.date,
          values.end || '00:00',
        )
    if (!found.date && endsAt <= startsAt)
      found[values.allDay ? 'endDate' : 'end'] = 'It must end after it starts.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setError(null)
    const input = {
      title: values.title,
      kind: values.kind,
      startsAt,
      endsAt,
      allDay: values.allDay,
      location: values.location || null,
      description: values.description || null,
      customerId: customer?.id ?? null,
      assignedTo: values.assignedTo || null,
    }
    const saved = item
      ? await updateCalendarEvent(item.id, input)
      : await createCalendarEvent(input)
    if (!saved.ok) {
      setBusy(false)
      return setError(saved.error.message)
    }
    const id = item ? item.id : (saved.data as { id: string }).id
    let notice = item ? 'Event saved.' : 'Event added.'
    // A new event goes to Google if asked; a changed one keeps its copy up to date.
    if (toGoogle && googleConnected) {
      const synced = await syncToGoogle(id)
      notice = synced.ok
        ? `${notice} It is in your Google Calendar too.`
        : `${notice} It could not be copied to Google Calendar: ${synced.error.message}`
    }
    setBusy(false)
    onDone(notice)
  }

  return (
    <Modal open title={item ? 'Edit event' : 'New event'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <Input
          id="event-title"
          label="Title"
          value={values.title}
          error={errors.title}
          onChange={(e) => set('title', e.target.value)}
        />
        <Select
          id="event-kind"
          label="Type"
          options={EVENT_KINDS}
          value={values.kind}
          onChange={(e) => set('kind', e.target.value as EventKind)}
        />
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={values.allDay}
            onChange={(e) => set('allDay', e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          All day
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            id="event-date"
            type="date"
            label={values.allDay ? 'From' : 'Date'}
            value={values.date}
            error={errors.date}
            onChange={(e) => set('date', e.target.value)}
          />
          {values.allDay ? (
            <Input
              id="event-end-date"
              type="date"
              label="To"
              value={values.endDate}
              error={errors.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          ) : (
            <>
              <Input
                id="event-start"
                type="time"
                label="Starts"
                value={values.start}
                onChange={(e) => set('start', e.target.value)}
              />
              <Input
                id="event-end"
                type="time"
                label="Ends"
                value={values.end}
                error={errors.end}
                onChange={(e) => set('end', e.target.value)}
              />
            </>
          )}
        </div>
        <Select
          id="event-for"
          label="For"
          options={[
            { value: '', label: 'Choose…' },
            ...team.map((t) => ({
              value: t.id,
              label: t.id === profile?.id ? `${t.name} (you)` : t.name,
            })),
          ]}
          value={values.assignedTo}
          onChange={(e) => set('assignedTo', e.target.value)}
        />
        <CustomerPicker value={customer} onChange={setCustomer} />
        <Input
          id="event-location"
          label="Where (optional)"
          value={values.location}
          onChange={(e) => set('location', e.target.value)}
        />
        <Textarea
          id="event-notes"
          label="Notes (optional)"
          rows={3}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
        />
        {googleConnected ? (
          <label className="flex items-center gap-2 text-body-md text-on-surface">
            <input
              type="checkbox"
              checked={toGoogle}
              onChange={(e) => setToGoogle(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {item?.googleEventId
              ? 'Keep the copy in Google Calendar up to date'
              : 'Add to my Google Calendar'}
          </label>
        ) : (
          <p className="text-label-md text-on-surface-variant">
            Connect Google Calendar on this page to copy events there.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {item ? 'Save Event' : 'Add Event'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
