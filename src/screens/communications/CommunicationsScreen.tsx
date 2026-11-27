import { AlertTriangle, CheckCircle2, Clock, FileText, Send } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { providerInfo } from '@shared/integrations'
import { StatTile } from '@/components/dashboard/StatTile'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { MessageStatusBadge } from '@/components/messages/MessageStatusBadge'
import { Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { getEmailSetup, getMessageSummary, listMessages } from '@/services/messages'
import { labelOf } from '@/types/support'
import { CHANNELS, MESSAGE_STATUSES, type EmailSetup } from '@/types/messages'
import { formatDateTime, formatNumber, percentOf } from '@/utils/format'
import { PAGE_SIZE, patchParams, readEnum, readPage } from '@/utils/listParams'

const STATUS_VALUES = ['attention', ...MESSAGE_STATUSES.map((s) => s.value)] as const

/** Tells people plainly whether email works, and what is missing if it does not. */
function SetupNotice({ setup }: { setup: EmailSetup | null }) {
  if (setup?.email) {
    if (setup.deliveryReports && setup.retries) return null
    return (
      <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
        Email is sending{setup.from ? ` from ${setup.from}` : ''}.{' '}
        {!setup.deliveryReports &&
          'Delivery reports are not set up, so emails show as Sent, not Delivered. '}
        {!setup.retries &&
          'Scheduled retries are not set up; failed emails are retried when someone next sends one.'}
      </p>
    )
  }
  return (
    <div
      role="status"
      className="mb-4 rounded-md bg-tertiary-container px-4 py-3 text-body-md text-on-tertiary-container"
    >
      <p className="font-semibold">Email is not set up yet.</p>
      <p>
        Emails can be written and are kept safely in the queue, but nothing is sent until an
        administrator adds the email settings in Vercel
        {setup && setup.missing.length > 0 ? ` (missing: ${setup.missing.join(', ')})` : ''}. See
        docs/COMMUNICATIONS.md for the steps.
      </p>
    </div>
  )
}

export default function CommunicationsScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const channel = readEnum(
    params,
    'channel',
    CHANNELS.map((c) => c.value),
  )
  const page = readPage(params)
  const state = useResource(
    () =>
      listMessages(
        { search, sort: 'created_at', ascending: false, page, pageSize: PAGE_SIZE },
        { status, channel },
      ),
    JSON.stringify([search, status, channel, page]),
  )
  const summary = useResource(() => getMessageSummary(), 'message-summary')
  const setup = useResource(() => getEmailSetup(), 'email-setup')
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

  return (
    <>
      <PageHeader
        title="Communications"
        subtitle="Every email sent to customers, and the calls and notes the team logged."
        actions={
          <Link to="/communications/templates" className={secondaryLink}>
            <FileText size={16} aria-hidden="true" /> Templates
          </Link>
        }
      />
      {setup.status !== 'loading' && <SetupNotice setup={setup.data} />}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Sent this month"
          icon={Send}
          state={summary}
          map={(s) => ({ value: formatNumber(s.sentThisMonth), detail: 'emails' })}
        />
        <StatTile
          label="Delivered"
          icon={CheckCircle2}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.deliveredThisMonth),
            detail: percentOf(s.deliveredThisMonth, s.sentThisMonth) ?? 'of emails sent',
          })}
        />
        <StatTile
          label="Waiting"
          icon={Clock}
          state={summary}
          map={(s) => ({ value: formatNumber(s.waiting), detail: 'queued or sending' })}
        />
        <StatTile
          label="Needs attention"
          icon={AlertTriangle}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.failed + s.bouncedThisMonth),
            detail: `${formatNumber(s.failed)} failed, ${formatNumber(s.bouncedThisMonth)} bounced`,
            tone: s.failed + s.bouncedThisMonth > 0 ? 'error' : 'neutral',
          })}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_12rem]">
        <SearchField
          id="message-search"
          label="Search"
          placeholder="Subject, email address or customer"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="message-status"
          label="Status"
          options={[
            { value: '', label: 'All statuses' },
            { value: 'attention', label: 'Needs attention' },
            ...MESSAGE_STATUSES,
          ]}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
        <Select
          id="message-channel"
          label="Channel"
          options={[{ value: '', label: 'All channels' }, ...CHANNELS]}
          value={channel}
          onChange={(e) => update({ channel: e.target.value })}
        />
      </div>

      <ListPanel
        title="History"
        noun="messages"
        state={state}
        page={page}
        filtered={Boolean(q || status || channel)}
        empty={
          <p>
            Nothing has been sent yet. Email a customer from their profile, an invoice or a support
            ticket.
          </p>
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Messages</caption>
            <thead>
              <tr>
                <Th>Message</Th>
                <Th>Customer</Th>
                <Th>Channel</Th>
                <Th>When</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <Td className="min-w-56">
                    <Link
                      to={`/communications/${m.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {m.subject || labelOf(CHANNELS, m.channel)}
                    </Link>
                    <span className="block text-label-md text-on-surface-variant">
                      {[
                        m.recipientName && m.recipientName !== m.customerName
                          ? m.recipientName
                          : null,
                        m.recipient,
                        m.invoiceNumber,
                        m.ticketReference,
                        m.createdByName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Td>
                  <Td>{m.customerName ?? '-'}</Td>
                  <Td className="whitespace-nowrap">
                    {labelOf(CHANNELS, m.channel)}
                    {m.provider && m.messageType !== 'logged' && (
                      <span className="block text-label-md text-on-surface-variant">
                        via {providerInfo(m.provider)?.label ?? m.provider}
                      </span>
                    )}
                    {m.direction === 'inbound' && (
                      <span className="block text-label-md text-on-surface-variant">incoming</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(m.sentAt ?? m.createdAt)}</Td>
                  <Td className="whitespace-nowrap">
                    <MessageStatusBadge status={m.status} />
                    {m.willRetry && (
                      <span className="block text-label-md text-on-surface-variant">
                        will try again
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ListPanel>
    </>
  )
}
