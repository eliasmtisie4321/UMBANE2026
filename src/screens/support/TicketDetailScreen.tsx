import { CheckCircle2, MessageSquareShare, Pencil, RefreshCw, UserPlus } from 'lucide-react'
import { ShareDialog } from '@/components/share/ShareDialog'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { DetailList } from '@/components/data/DetailList'
import { Notice } from '@/components/data/ListPanel'
import { inlineLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/support/TicketBadges'
import { AssignDialog, StatusDialog } from '@/components/support/TicketDialogs'
import {
  AttachmentsPanel,
  ConversationPanel,
  HistoryPanel,
} from '@/components/support/TicketPanels'
import { LinkedTasksPanel } from '@/components/team/LinkedTasksPanel'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getTicket } from '@/services/support'
import { type Ticket, type TicketStatus } from '@/types/support'
import { useTicketCategories } from '@/hooks/useTicketCategories'
import { formatDateTime } from '@/utils/format'
import { formatPhone } from '@/utils/phone'

function TicketBody({
  ticket: t,
  version,
  onChanged,
}: {
  ticket: Ticket
  version: number
  onChanged: (notice: string) => void
}) {
  const categories = useTicketCategories()
  const { profile } = useAuth()
  const role = profile?.role ?? 'client'
  const isStaff = role !== 'client'
  const closed = t.status === 'closed'
  const [dialog, setDialog] = useState<'assign' | 'email' | TicketStatus | 'status' | null>(null)
  const done = (notice: string) => {
    setDialog(null)
    onChanged(notice)
  }

  return (
    <>
      <PageHeader
        title={t.subject}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-on-surface">{t.reference}</span>
            <TicketStatusBadge status={t.status} />
            {isStaff && <TicketPriorityBadge priority={t.priority} />}
            <span>
              {isStaff
                ? `${t.assigneeName ? `Assigned to ${t.assigneeName}` : 'Not assigned'} · Opened ${formatDateTime(t.createdAt)}`
                : `Opened ${formatDateTime(t.createdAt)}`}
            </span>
          </span>
        }
        back={{ to: '/support-tickets', label: isStaff ? 'Support Tickets' : 'Support' }}
        actions={
          isStaff && !closed ? (
            <>
              <Link to={`/support-tickets/${t.id}/edit`} className={secondaryLink}>
                <Pencil size={16} aria-hidden="true" /> Edit
              </Link>
              <Button variant="secondary" onClick={() => setDialog('email')}>
                <MessageSquareShare size={16} aria-hidden="true" /> Message Customer
              </Button>
              <Button variant="secondary" onClick={() => setDialog('assign')}>
                <UserPlus size={16} aria-hidden="true" /> Assign Ticket
              </Button>
              <Button variant="secondary" onClick={() => setDialog('status')}>
                <RefreshCw size={16} aria-hidden="true" /> Update Status
              </Button>
              {t.status !== 'resolved' && (
                <Button onClick={() => setDialog('resolved')}>
                  <CheckCircle2 size={16} aria-hidden="true" /> Resolve Ticket
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {t.status === 'resolved' && !isStaff && (
        <p className="mb-4 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container">
          The team has marked this as resolved. If the problem is still there, reply below and the
          ticket will be reopened.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Panel title="Issue" subtitle={categories.label(t.category)}>
            <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
              {t.description || 'No description.'}
            </p>
            {t.resolution && (
              <div className="mt-4 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3">
                <p className="text-label-md font-semibold text-on-surface">
                  {t.status === 'closed' ? 'Resolution or reason for closing' : 'Resolution'}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-body-md">{t.resolution}</p>
              </div>
            )}
          </Panel>
          <AttachmentsPanel
            ticket={{ id: t.id, businessId: profile?.business_id ?? '' }}
            canUpload={!closed}
            version={version}
            onUploaded={onChanged}
          />
          <ConversationPanel
            ticketId={t.id}
            isStaff={isStaff}
            canReply={!closed}
            version={version}
            onSent={onChanged}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Details">
            <DetailList
              items={[
                ...(isStaff
                  ? [
                      {
                        label: 'Customer',
                        value: canAccess(role, '/customers') ? (
                          <Link to={`/customers/${t.customerId}`} className={inlineLink}>
                            {t.customerName}
                          </Link>
                        ) : (
                          t.customerName
                        ),
                      },
                      { label: 'Phone', value: t.customerPhone && formatPhone(t.customerPhone) },
                      { label: 'Email', value: t.customerEmail },
                    ]
                  : []),
                {
                  label: 'Property',
                  value: t.propertyId && (
                    <Link to={`/properties/${t.propertyId}`} className={inlineLink}>
                      {t.propertyName}
                    </Link>
                  ),
                },
                {
                  label: 'Meter',
                  value: t.meterId && (
                    <Link to={`/electricity-meters/${t.meterId}`} className={inlineLink}>
                      {t.meterSerial}
                    </Link>
                  ),
                },
                ...(isStaff
                  ? [{ label: 'Assigned to', value: t.assigneeName ?? 'Nobody yet' }]
                  : []),
                { label: 'Opened', value: formatDateTime(t.createdAt) },
                {
                  label: 'First reply',
                  value: t.firstResponseAt ? formatDateTime(t.firstResponseAt) : 'Not yet',
                },
                { label: 'Resolved', value: t.resolvedAt && formatDateTime(t.resolvedAt) },
                { label: 'Closed', value: t.closedAt && formatDateTime(t.closedAt) },
              ]}
            />
          </Panel>
          {isStaff && (
            <LinkedTasksPanel
              ticketId={t.id}
              canCreate={canAccess(role, '/tasks/new') && !closed}
            />
          )}
          <HistoryPanel ticketId={t.id} version={version} />
        </div>
      </div>

      {dialog === 'email' && (
        <ShareDialog
          context={{
            title: `Message ${t.customerName} about ${t.reference}`,
            customer: { id: t.customerId, name: t.customerName },
            templateKey: 'ticket_update',
            values: { ticket_reference: t.reference, ticket_subject: t.subject },
            ticketId: t.id,
          }}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === 'assign' && (
        <AssignDialog ticket={t} onClose={() => setDialog(null)} onDone={done} />
      )}
      {(dialog === 'status' || dialog === 'resolved') && (
        <StatusDialog
          ticket={t}
          initial={dialog === 'resolved' ? 'resolved' : undefined}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </>
  )
}

export default function TicketDetailScreen() {
  const { id = '' } = useParams()
  return <TicketDetail key={id} id={id} />
}

function TicketDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const state = useResource(() => getTicket(id), `ticket-${id}`)
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(ticket) => (
          <TicketBody
            ticket={ticket}
            version={version}
            onChanged={(text) => {
              setNotice(text)
              setVersion((v) => v + 1)
              state.reload()
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
