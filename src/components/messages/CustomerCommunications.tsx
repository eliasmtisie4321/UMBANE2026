import { MessageSquarePlus, MessageSquareShare } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { useResource } from '@/hooks/useResource'
import {
  getCustomerPreferences,
  listMessages,
  logContact,
  setCustomerPreferences,
} from '@/services/messages'
import { labelOf } from '@/types/support'
import { CHANNELS, type CustomerPreferences, type Direction } from '@/types/messages'
import { formatDate, formatDateTime } from '@/utils/format'
import { ShareDialog } from '@/components/share/ShareDialog'
import { MessageStatusBadge } from './MessageStatusBadge'

function LogContactDialog({
  customerId,
  onClose,
  onDone,
}: {
  customerId: string
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]['value']>('call')
  const [direction, setDirection] = useState<Direction>('outbound')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!body.trim()) return setFieldError('Write what was said or agreed.')
    if (body.trim().length > 10000) return setFieldError('Keep the note to 10000 characters.')
    setBusy(true)
    // An email logged here is one sent outside Umbane, so it is recorded as received or as a note.
    const result = await logContact({
      customerId,
      channel,
      direction: channel === 'email' ? 'inbound' : direction,
      subject: subject.trim() || null,
      body,
    })
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    onDone('Contact logged.')
  }

  return (
    <Modal open title="Log a contact" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <Select
          id="contact-channel"
          label="How"
          options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        />
        {channel === 'email' ? (
          <p className="text-label-md text-on-surface-variant">
            For an email the customer sent you. To send one, use Send Message.
          </p>
        ) : (
          <RadioGroup
            legend="Who started it"
            value={direction}
            options={[
              { value: 'outbound', label: 'We contacted them' },
              { value: 'inbound', label: 'They contacted us' },
            ]}
            onChange={setDirection}
          />
        )}
        <Input
          id="contact-subject"
          label="Topic (optional)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <Textarea
          id="contact-body"
          label="What was said or agreed"
          rows={4}
          value={body}
          error={fieldError}
          onChange={(e) => {
            setBody(e.target.value)
            setFieldError(undefined)
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function Preferences({
  customerId,
  prefs,
  onSaved,
}: {
  customerId: string
  prefs: CustomerPreferences
  onSaved: (notice: string) => void
}) {
  const [optOut, setOptOut] = useState(prefs.emailOptOut)
  const [consent, setConsent] = useState(prefs.marketingConsent)
  const [smsOff, setSmsOff] = useState(Boolean(prefs.smsOptOut))
  const [whatsapp, setWhatsapp] = useState(Boolean(prefs.whatsappOptIn))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed =
    optOut !== prefs.emailOptOut ||
    consent !== prefs.marketingConsent ||
    smsOff !== Boolean(prefs.smsOptOut) ||
    whatsapp !== Boolean(prefs.whatsappOptIn)

  async function save() {
    setBusy(true)
    setError(null)
    const result = await setCustomerPreferences(customerId, {
      emailOptOut: optOut,
      marketingConsent: optOut ? false : consent,
      smsOptOut: smsOff,
      whatsappOptIn: whatsapp,
    })
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    onSaved('Communication preferences saved.')
  }

  return (
    <fieldset className="mb-4 rounded-md border border-outline-variant p-3">
      <legend className="px-1 text-label-md font-semibold text-on-surface">
        Communication preferences
      </legend>
      {error && <FormError>{error}</FormError>}
      {prefs.suppressedAt && (
        <p className="mb-2 text-body-md text-error">
          {prefs.suppressedReason === 'complained'
            ? 'They marked an email as spam, so email to them is stopped.'
            : 'Email to this address bounced, so it is stopped until the address changes.'}
        </p>
      )}
      <label className="flex items-start gap-2 text-body-md">
        <input
          type="checkbox"
          checked={optOut}
          onChange={(e) => {
            setOptOut(e.target.checked)
            if (e.target.checked) setConsent(false)
          }}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <span>Does not want email (no invoices or updates by email)</span>
      </label>
      <label className="mt-2 flex items-start gap-2 text-body-md">
        <input
          type="checkbox"
          checked={consent}
          disabled={optOut}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <span>
          Agreed to receive marketing email
          <span className="block text-label-md text-on-surface-variant">
            Only tick this when the customer has said yes; it is recorded with your name and the
            date.
          </span>
        </span>
      </label>
      <label className="mt-2 flex items-start gap-2 text-body-md">
        <input
          type="checkbox"
          checked={smsOff}
          onChange={(e) => setSmsOff(e.target.checked)}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <span>Does not want SMS</span>
      </label>
      <label className="mt-2 flex items-start gap-2 text-body-md">
        <input
          type="checkbox"
          checked={whatsapp}
          onChange={(e) => setWhatsapp(e.target.checked)}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <span>
          Agreed to WhatsApp messages
          <span className="block text-label-md text-on-surface-variant">
            WhatsApp needs the customer’s yes first. Recorded with your name and the date.
          </span>
        </span>
      </label>
      {prefs.consentUpdatedAt && (
        <p className="mt-2 text-label-md text-on-surface-variant">
          Last changed {formatDate(prefs.consentUpdatedAt)}
        </p>
      )}
      {changed && (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" loading={busy} onClick={() => void save()}>
            Save Preferences
          </Button>
        </div>
      )}
    </fieldset>
  )
}

/** A customer's emails, calls and notes, with their email preferences. */
export function CustomerCommunications({
  customerId,
  customerName,
  onNotice,
}: {
  customerId: string
  customerName: string
  onNotice: (notice: string) => void
}) {
  const [version, setVersion] = useState(0)
  const [dialog, setDialog] = useState<'email' | 'log' | null>(null)
  const prefs = useResource(
    () => getCustomerPreferences(customerId),
    `prefs-${customerId}-${version}`,
  )
  const history = useResource(
    () =>
      listMessages(
        { search: '', sort: 'created_at', ascending: false, page: 1, pageSize: 10 },
        { status: '', channel: '', customerId },
      ),
    `customer-messages-${customerId}-${version}`,
  )
  const done = (notice: string) => {
    setDialog(null)
    setVersion((v) => v + 1)
    onNotice(notice)
  }

  return (
    <Panel
      title="Communications"
      subtitle="Emails, calls and notes, newest first"
      className="lg:col-span-2"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog('log')}>
            <MessageSquarePlus size={16} aria-hidden="true" /> Log Contact
          </Button>
          <Button variant="secondary" onClick={() => setDialog('email')}>
            <MessageSquareShare size={16} aria-hidden="true" /> Send Message
          </Button>
        </div>
      }
    >
      <ResourceBoundary state={prefs} skeletonLines={2}>
        {(p) => <Preferences key={`${version}`} customerId={customerId} prefs={p} onSaved={done} />}
      </ResourceBoundary>
      <ResourceBoundary
        state={history}
        isEmpty={(page) => page.rows.length === 0}
        empty="Nothing has been sent or logged for this customer yet."
      >
        {(page) => (
          <ul className="divide-y divide-outline-variant" aria-label="Communication history">
            {page.rows.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link
                    to={`/communications/${m.id}`}
                    className="block truncate text-body-md font-medium text-primary hover:underline"
                  >
                    {m.subject || labelOf(CHANNELS, m.channel)}
                  </Link>
                  <p className="text-label-md text-on-surface-variant">
                    {[
                      labelOf(CHANNELS, m.channel),
                      m.direction === 'inbound' ? 'from the customer' : null,
                      m.createdByName,
                      formatDateTime(m.createdAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <MessageStatusBadge status={m.status} />
              </li>
            ))}
          </ul>
        )}
      </ResourceBoundary>

      {dialog === 'email' && (
        <ShareDialog
          context={{
            title: `Message ${customerName}`,
            customer: { id: customerId, name: customerName },
          }}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === 'log' && (
        <LogContactDialog customerId={customerId} onClose={() => setDialog(null)} onDone={done} />
      )}
    </Panel>
  )
}
