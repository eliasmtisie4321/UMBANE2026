import { Ban, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { MessageStatusBadge } from '@/components/messages/MessageStatusBadge'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  cancelMessage,
  getMessage,
  listMessageEvents,
  retryMessage,
  sendNow,
} from '@/services/messages'
import { labelOf } from '@/types/support'
import { CHANNELS, type Message, type MessageEvent } from '@/types/messages'
import { formatDateTime } from '@/utils/format'

const EVENT_LABELS: Record<string, string> = {
  queued: 'Queued for sending',
  sent: 'Accepted by the email provider',
  failed: 'Sending failed',
  retried: 'Queued again by a team member',
  cancelled: 'Cancelled',
  'email.sent': 'Provider sent the email',
  'email.delivered': 'Delivered to the inbox server',
  'email.delivery_delayed': 'Delivery delayed; the provider keeps trying',
  'email.bounced': 'Bounced: the address does not accept email',
  'email.complained': 'The customer marked it as spam',
}

function describe(e: MessageEvent) {
  const label = EVENT_LABELS[e.event] ?? e.event
  const error = typeof e.detail?.error === 'string' ? e.detail.error : null
  const attempt = typeof e.detail?.attempt === 'number' ? `attempt ${e.detail.attempt}` : null
  const reason = typeof e.detail?.reason === 'string' ? e.detail.reason : null
  return { label, extra: [attempt, error, reason].filter(Boolean).join(' · ') }
}

function Body({ m, onChanged }: { m: Message; onChanged: (n: string) => void }) {
  const events = useResource(() => listMessageEvents(m.id), `message-events-${m.id}-${m.status}`)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEmail = m.channel === 'email' && m.direction === 'outbound'

  async function retry() {
    setBusy(true)
    setError(null)
    const r = await retryMessage(m.id)
    if (!r.ok) {
      setBusy(false)
      return setError(r.error.message)
    }
    const sent = await sendNow(m.id)
    setBusy(false)
    onChanged(
      sent.state === 'sent'
        ? 'Email sent.'
        : sent.state === 'failed'
          ? 'It failed again. It will be tried again automatically.'
          : 'Queued again. It will be sent when email is available.',
    )
  }

  async function cancel() {
    setBusy(true)
    setError(null)
    const r = await cancelMessage(m.id)
    setBusy(false)
    if (!r.ok) return setError(r.error.message)
    setConfirming(false)
    onChanged('Email cancelled. It will not be sent.')
  }

  return (
    <>
      <PageHeader
        title={m.subject || labelOf(CHANNELS, m.channel)}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <MessageStatusBadge status={m.status} />
            <span>
              {labelOf(CHANNELS, m.channel)}
              {m.direction === 'inbound' ? ' from the customer' : ''} ·{' '}
              {formatDateTime(m.createdAt)}
            </span>
          </span>
        }
        back={{ to: '/communications', label: 'Communications' }}
        actions={
          isEmail ? (
            <>
              {(m.status === 'queued' || m.status === 'failed') && (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  <Ban size={16} aria-hidden="true" /> Cancel Email
                </Button>
              )}
              {m.status === 'failed' && (
                <Button loading={busy} onClick={() => void retry()}>
                  <RotateCcw size={16} aria-hidden="true" /> Try Again
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      {m.status === 'failed' && (
        <p className="mb-4 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {m.willRetry && m.nextAttemptAt
            ? `Sending failed. It will be tried again automatically after ${formatDateTime(m.nextAttemptAt)}.`
            : 'Sending failed and will not be tried again by itself. Check the reason below, then try again.'}
          {m.error && <span className="mt-1 block font-mono text-label-md">{m.error}</span>}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Message" className="lg:col-span-2">
          <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
            {m.body || 'No text.'}
          </p>
          {m.attachmentName && (
            <p className="mt-3 text-label-md text-on-surface-variant">
              Attached: {m.attachmentName}
            </p>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Details">
            <DetailList
              items={[
                {
                  label: 'Customer',
                  value: m.customerId && (
                    <Link to={`/customers/${m.customerId}`} className={inlineLink}>
                      {m.customerName}
                    </Link>
                  ),
                },
                { label: 'To', value: m.recipient },
                {
                  label: 'Invoice',
                  value: m.invoiceId && (
                    <Link to={`/invoices/${m.invoiceId}`} className={inlineLink}>
                      {m.invoiceNumber}
                    </Link>
                  ),
                },
                {
                  label: 'Ticket',
                  value: m.ticketId && (
                    <Link to={`/support-tickets/${m.ticketId}`} className={inlineLink}>
                      {m.ticketReference}
                    </Link>
                  ),
                },
                { label: m.status === 'logged' ? 'Logged by' : 'Sent by', value: m.createdByName },
                ...(isEmail
                  ? [
                      { label: 'Sent', value: m.sentAt && formatDateTime(m.sentAt) },
                      { label: 'Delivered', value: m.deliveredAt && formatDateTime(m.deliveredAt) },
                      { label: 'Attempts', value: String(m.attempts) },
                      {
                        label: 'Kind',
                        value: m.purpose === 'marketing' ? 'Marketing' : 'Service message',
                      },
                    ]
                  : []),
              ]}
            />
          </Panel>
          {isEmail && (
            <Panel title="Delivery history">
              <ResourceBoundary
                state={events}
                isEmpty={(r) => r.length === 0}
                empty="Nothing reported yet."
              >
                {(rows) => (
                  <ol className="flex flex-col gap-3" aria-label="Delivery history">
                    {rows.map((e) => {
                      const d = describe(e)
                      return (
                        <li key={e.id}>
                          <p className="text-body-md text-on-surface">{d.label}</p>
                          <p className="text-label-md text-on-surface-variant">
                            {[formatDateTime(e.occurredAt), d.extra].filter(Boolean).join(' · ')}
                          </p>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </ResourceBoundary>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Cancel this email?"
        confirmLabel="Cancel email"
        cancelLabel="Keep it"
        danger
        busy={busy}
        error={error}
        onConfirm={() => void cancel()}
        onCancel={() => setConfirming(false)}
      >
        <p>It will not be sent. It stays in the history as cancelled.</p>
      </ConfirmDialog>
    </>
  )
}

export default function MessageDetailScreen() {
  const { id = '' } = useParams()
  const [notice, setNotice] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const state = useResource(() => getMessage(id), `message-${id}-${version}`)
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(m) => (
          <Body
            m={m}
            onChanged={(n) => {
              setNotice(n)
              setVersion((v) => v + 1)
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
