import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { PageHeader } from '@/components/data/PageHeader'
import { StatusBadge } from '@/components/data/StatusBadge'
import { Badge, Button, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getCustomer,
  getCustomerInvoices,
  getCustomerOrders,
  getCustomerProperties,
  getCustomerTickets,
  setCustomerStatus,
} from '@/services/customers'
import { SEGMENTS, type Customer } from '@/types/customers'
import { formatDate, formatRand, humanize } from '@/utils/format'
import { formatPhone } from '@/utils/phone'
import { maskSaId } from '@/utils/saId'

const linkButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container'

function addressLines(c: Customer): string {
  const lines = [
    c.streetAddress,
    c.suburb,
    [c.city, c.postalCode].filter(Boolean).join(' '),
    c.province,
  ]
  return lines.filter((l) => l && l.trim() !== '').join(', ')
}

function ProfileBody({ customer, reload }: { customer: Customer; reload: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inactive = customer.status === 'inactive'

  async function toggle() {
    setBusy(true)
    const result = await setCustomerStatus(customer.id, inactive ? 'active' : 'inactive')
    setBusy(false)
    if (result.ok) {
      setConfirming(false)
      reload()
    } else {
      setError(result.error.message)
    }
  }

  const properties = useResource(() => getCustomerProperties(customer.id), `props-${customer.id}`)
  const invoices = useResource(() => getCustomerInvoices(customer.id), `inv-${customer.id}`)
  const orders = useResource(() => getCustomerOrders(customer.id), `ord-${customer.id}`)
  const tickets = useResource(() => getCustomerTickets(customer.id), `tkt-${customer.id}`)

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {customer.companyName && <span>{customer.companyName}</span>}
            <StatusBadge status={customer.status} />
          </span>
        }
        back={{ to: '/customers', label: 'Customers' }}
        actions={
          <>
            <Link to={`/customers/${customer.id}/edit`} className={linkButton}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </Link>
            <Link to={`/properties/new?customer=${customer.id}`} className={linkButton}>
              <Plus size={16} aria-hidden="true" /> Add property
            </Link>
            <Button
              variant={inactive ? 'secondary' : 'danger'}
              onClick={() => {
                setError(null)
                setConfirming(true)
              }}
            >
              {inactive ? 'Reactivate' : 'Deactivate'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Account">
          <DetailList
            items={[
              { label: 'Customer type', value: humanize(customer.customerType) },
              {
                label: 'Segment',
                value: SEGMENTS.find((s) => s.value === customer.segment)?.label,
              },
              {
                label: 'ID number',
                value: customer.idNumber ? (
                  <span className="font-mono">{maskSaId(customer.idNumber)}</span>
                ) : null,
              },
              { label: 'Registration number', value: customer.registrationNumber },
              { label: 'Customer since', value: formatDate(customer.createdAt) },
              { label: 'Last updated', value: formatDate(customer.updatedAt) },
            ]}
          />
        </Panel>
        <Panel title="Contact">
          <DetailList
            items={[
              {
                label: 'Email',
                value: customer.email && (
                  <a className="text-secondary hover:underline" href={`mailto:${customer.email}`}>
                    {customer.email}
                  </a>
                ),
              },
              {
                label: 'Phone',
                value: customer.phone && (
                  <a className="text-secondary hover:underline" href={`tel:${customer.phone}`}>
                    {formatPhone(customer.phone)}
                  </a>
                ),
              },
              {
                label: 'Alternative phone',
                value: customer.altPhone && (
                  <a className="text-secondary hover:underline" href={`tel:${customer.altPhone}`}>
                    {formatPhone(customer.altPhone)}
                  </a>
                ),
              },
              { label: 'Address', value: addressLines(customer) },
            ]}
          />
        </Panel>
        {customer.notes && (
          <Panel title="Notes" className="lg:col-span-2">
            <p className="whitespace-pre-wrap text-body-md text-on-surface">{customer.notes}</p>
          </Panel>
        )}

        <Panel title="Properties" subtitle="Registered to this customer" className="lg:col-span-2">
          <ResourceBoundary
            state={properties}
            isEmpty={(rows) => rows.length === 0}
            empty="No properties are registered to this customer yet."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Properties</caption>
                <thead>
                  <tr>
                    <Th>Property</Th>
                    <Th>Address</Th>
                    <Th className="text-right">Meters</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <Link
                          to={`/properties/${p.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {p.name ?? p.reference ?? 'Unnamed property'}
                        </Link>
                        {p.reference && p.name && (
                          <p className="font-mono text-label-sm text-on-surface-variant">
                            {p.reference}
                          </p>
                        )}
                      </Td>
                      <Td>{[p.address, p.city].filter(Boolean).join(', ')}</Td>
                      <Td className="text-right">{p.meterCount}</Td>
                      <Td>
                        <StatusBadge status={p.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>

        <Panel title="Invoices" subtitle="Most recent first">
          <ResourceBoundary
            state={invoices}
            isEmpty={(rows) => rows.length === 0}
            empty="No invoices for this customer."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Invoices</caption>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <Td className="whitespace-nowrap font-mono text-label-md">
                        {i.invoiceNumber}
                      </Td>
                      <Td>
                        <Badge
                          tone={i.isOverdue ? 'error' : i.status === 'paid' ? 'success' : 'neutral'}
                        >
                          {i.isOverdue ? 'Overdue' : humanize(i.status)}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        {formatRand(i.balance, { cents: true })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>

        <Panel title="Orders" subtitle="Most recent first">
          <ResourceBoundary
            state={orders}
            isEmpty={(rows) => rows.length === 0}
            empty="No orders for this customer."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Orders</caption>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <Td className="whitespace-nowrap">{formatDate(o.createdAt)}</Td>
                      <Td>
                        <Badge>{humanize(o.status)}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        {formatRand(o.total, { cents: true })}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>

        <Panel title="Support tickets" subtitle="Most recent first" className="lg:col-span-2">
          <ResourceBoundary
            state={tickets}
            isEmpty={(rows) => rows.length === 0}
            empty="No support tickets for this customer."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Support tickets</caption>
                <thead>
                  <tr>
                    <Th>Reference</Th>
                    <Th>Subject</Th>
                    <Th>Status</Th>
                    <Th>Priority</Th>
                    <Th>Opened</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <Td className="whitespace-nowrap font-mono text-label-md">{t.reference}</Td>
                      <Td>{t.subject}</Td>
                      <Td>
                        <Badge
                          tone={
                            t.status === 'resolved' || t.status === 'closed' ? 'success' : 'info'
                          }
                        >
                          {humanize(t.status)}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            t.priority === 'urgent' || t.priority === 'high' ? 'warning' : 'neutral'
                          }
                        >
                          {humanize(t.priority)}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirming}
        title={inactive ? 'Reactivate customer' : 'Deactivate customer'}
        confirmLabel={inactive ? 'Reactivate' : 'Deactivate'}
        danger={!inactive}
        busy={busy}
        error={error}
        onConfirm={toggle}
        onCancel={() => setConfirming(false)}
      >
        {inactive ? (
          <p>{customer.name} will be marked active again.</p>
        ) : (
          <p>
            {customer.name} will be marked inactive. Their records and history are kept, and you can
            reactivate them at any time.
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}

export default function CustomerProfileScreen() {
  const { id = '' } = useParams()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const state = useResource(() => getCustomer(id), `customer-${id}`)

  return (
    <>
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          {notice}
        </p>
      )}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(customer) => <ProfileBody customer={customer} reload={state.reload} />}
      </ResourceBoundary>
    </>
  )
}
