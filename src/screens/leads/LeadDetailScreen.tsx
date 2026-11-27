import { Ban, MessageSquareShare, Pencil, RotateCcw, ShoppingCart, UserCheck } from 'lucide-react'
import { ShareDialog } from '@/components/share/ShareDialog'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { DetailList } from '@/components/data/DetailList'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink, primaryLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { StatusBadge } from '@/components/data/StatusBadge'
import { ActivitiesPanel, TimelinePanel } from '@/components/sales/ActivityPanels'
import { ConvertLeadDialog } from '@/components/sales/ConvertLeadDialog'
import { ReasonDialog } from '@/components/sales/ReasonDialog'
import { Badge, Button, Select, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getLead, loseLead, setLeadStage } from '@/services/leads'
import { getLeadOrders } from '@/services/orders'
import {
  APPROVED_STAGES,
  LEAD_SOURCES,
  LEAD_STAGES,
  type Lead,
  type LeadStage,
} from '@/types/sales'
import { formatDate, formatRand } from '@/utils/format'
import { formatPhone } from '@/utils/phone'

function LeadBody({
  lead,
  version,
  onChanged,
}: {
  lead: Lead
  version: number
  onChanged: (notice: string) => void
}) {
  const [dialog, setDialog] = useState<'lose' | 'convert' | 'message' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approved = APPROVED_STAGES.includes(lead.status)

  async function moveTo(stage: LeadStage, notice: string) {
    setBusy(true)
    setError(null)
    const result = await setLeadStage(lead.id, stage)
    setBusy(false)
    if (result.ok) onChanged(notice)
    else setError(result.error.message)
  }

  return (
    <>
      <PageHeader
        title={lead.companyName ?? lead.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{lead.reference}</span>
            <StatusBadge status={lead.status} />
          </span>
        }
        back={{ to: '/leads', label: 'Leads' }}
        actions={
          <>
            {lead.isOpen && (
              <Button variant="secondary" onClick={() => setDialog('lose')}>
                <Ban size={16} aria-hidden="true" /> Mark as Lost
              </Button>
            )}
            {lead.status === 'lost' && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void moveTo('contacted', 'Lead reopened.')}
              >
                <RotateCcw size={16} aria-hidden="true" /> Reopen
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialog('message')}>
              <MessageSquareShare size={16} aria-hidden="true" /> Send Message
            </Button>
            <Link to={`/leads/${lead.id}/edit`} className={secondaryLink}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </Link>
            {approved && (
              <Button onClick={() => setDialog('convert')}>
                <UserCheck size={16} aria-hidden="true" /> Convert to Customer
              </Button>
            )}
            {lead.customerId && (
              <Link to={`/sales-orders/new?lead=${lead.id}`} className={primaryLink}>
                <ShoppingCart size={16} aria-hidden="true" /> Create Order
              </Link>
            )}
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      {lead.status === 'lost' && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          Lost{lead.closedOn ? ` on ${formatDate(lead.closedOn)}` : ''}: {lead.lostReason}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Contact">
          <DetailList
            items={[
              { label: 'Contact name', value: lead.name },
              { label: 'Company', value: lead.companyName },
              { label: 'Email', value: lead.email },
              { label: 'Phone', value: formatPhone(lead.phone) },
              ...(lead.customerId
                ? [
                    {
                      label: 'Customer',
                      value: (
                        <Link to={`/customers/${lead.customerId}`} className={inlineLink}>
                          {lead.customerName ?? 'View customer'}
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Panel>
        <Panel title="Opportunity">
          {lead.isOpen && (
            <div className="mb-4 max-w-xs">
              <Select
                id="lead-stage"
                label="Stage"
                options={LEAD_STAGES}
                value={lead.status}
                disabled={busy}
                hint={
                  approved
                    ? undefined
                    : 'A lead can become a customer from the Qualified stage onwards.'
                }
                onChange={(e) => void moveTo(e.target.value as LeadStage, 'Stage updated.')}
              />
            </div>
          )}
          <DetailList
            items={[
              {
                label: 'Estimated value',
                value: lead.estimatedValue === null ? null : formatRand(lead.estimatedValue),
              },
              { label: 'Interested in', value: lead.serviceInterest },
              {
                label: 'Source',
                value: LEAD_SOURCES.find((s) => s.value === lead.source)?.label,
              },
              { label: 'Assigned to', value: lead.assignedName },
              {
                label: 'Next follow-up',
                value: lead.followUpOn && (
                  <span className="inline-flex items-center gap-2">
                    {formatDate(lead.followUpOn)}
                    {lead.followUpOverdue && <Badge tone="error">Overdue</Badge>}
                  </span>
                ),
              },
              {
                label: 'Expected close',
                value: lead.expectedClose ? formatDate(lead.expectedClose) : null,
              },
            ]}
          />
          {lead.notes && (
            <p className="mt-4 whitespace-pre-wrap border-t border-outline-variant pt-4 text-body-md text-on-surface">
              {lead.notes}
            </p>
          )}
        </Panel>
        <ActivitiesPanel subject={{ leadId: lead.id }} />
        <TimelinePanel subject={{ leadId: lead.id }} version={version} />
        {lead.customerId && <LeadOrdersPanel leadId={lead.id} />}
      </div>

      {dialog === 'lose' && (
        <ReasonDialog
          title="Mark this lead as lost?"
          description="The lead and its history are kept. You can reopen it later."
          confirmLabel="Mark as lost"
          submit={(reason) => loseLead(lead.id, reason)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            onChanged('Lead marked as lost.')
          }}
        />
      )}
      {dialog === 'message' && (
        <ShareDialog
          context={{
            title: `Message ${lead.name}`,
            lead: { id: lead.id, name: lead.name },
            values: { customer_name: lead.name },
          }}
          onClose={() => setDialog(null)}
          onDone={(notice) => {
            setDialog(null)
            onChanged(notice)
          }}
        />
      )}
      {dialog === 'convert' && (
        <ConvertLeadDialog
          lead={lead}
          onClose={() => setDialog(null)}
          onConverted={(_id, created) => {
            setDialog(null)
            onChanged(
              created
                ? 'Lead converted and customer created.'
                : 'Lead converted and linked to the customer.',
            )
          }}
        />
      )}
    </>
  )
}

function LeadOrdersPanel({ leadId }: { leadId: string }) {
  const state = useResource(() => getLeadOrders(leadId), `lead-orders-${leadId}`)
  return (
    <Panel title="Orders from this lead" className="lg:col-span-2">
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No orders have been created from this lead."
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Orders from this lead</caption>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Date</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link to={`/sales-orders/${o.id}`} className={`font-mono ${inlineLink}`}>
                      {o.reference}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(o.orderDate)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {formatRand(o.total, { cents: true })}
                  </Td>
                  <Td>
                    <StatusBadge status={o.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ResourceBoundary>
    </Panel>
  )
}

export default function LeadDetailScreen() {
  const { id = '' } = useParams()
  return <LeadDetail key={id} id={id} />
}

function LeadDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const state = useResource(() => getLead(id), `lead-${id}`)

  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(lead) => (
          <LeadBody
            lead={lead}
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
