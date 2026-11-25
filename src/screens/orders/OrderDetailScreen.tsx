import { Ban, CheckCheck, ClipboardCheck, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { Notice } from '@/components/data/ListPanel'
import { inlineLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { StatusBadge } from '@/components/data/StatusBadge'
import { ActivitiesPanel, TimelinePanel } from '@/components/sales/ActivityPanels'
import { OrderTotalsList } from '@/components/sales/OrderTotalsList'
import { ReasonDialog } from '@/components/sales/ReasonDialog'
import { Button, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getOrder, setOrderStatus } from '@/services/orders'
import { PAYMENT_METHODS, type Order } from '@/types/sales'
import { formatDate, formatNumber, formatRand } from '@/utils/format'

const rand = (n: number) => formatRand(n, { cents: true })

const STEPS = {
  confirmed: {
    title: 'Confirm this order?',
    body: 'The customer, lines, discount and VAT can no longer be changed after this.',
    label: 'Confirm order',
    notice: 'Order confirmed.',
  },
  fulfilled: {
    title: 'Mark this order as fulfilled?',
    body: 'The sale is recorded now. A fulfilled order is final and cannot be cancelled.',
    label: 'Mark as fulfilled',
    notice: 'Order fulfilled and sale recorded.',
  },
} as const

function OrderBody({
  order,
  version,
  onChanged,
}: {
  order: Order
  version: number
  onChanged: (notice: string) => void
}) {
  const { profile } = useAuth()
  const role = profile?.role ?? 'client'
  const canWrite = canAccess(role, '/sales-orders/new')
  const [step, setStep] = useState<'confirmed' | 'fulfilled' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = order.status === 'pending' || order.status === 'confirmed'
  const next = step === 'confirmed' || step === 'fulfilled' ? STEPS[step] : null

  async function advance() {
    if (step !== 'confirmed' && step !== 'fulfilled') return
    setBusy(true)
    setError(null)
    const result = await setOrderStatus(order.id, step, null)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setStep(null)
    onChanged(STEPS[step].notice)
  }
  const start = (s: 'confirmed' | 'fulfilled' | 'cancel') => {
    setError(null)
    setStep(s)
  }

  return (
    <>
      <PageHeader
        title={order.reference}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <span>
              {order.customerName} · {formatDate(order.orderDate)}
            </span>
          </span>
        }
        back={{ to: '/sales-orders', label: 'Sales & Orders' }}
        actions={
          canWrite &&
          open && (
            <>
              <Button variant="secondary" onClick={() => start('cancel')}>
                <Ban size={16} aria-hidden="true" /> Cancel Order
              </Button>
              {order.status === 'pending' ? (
                <>
                  <Link to={`/sales-orders/${order.id}/edit`} className={secondaryLink}>
                    <Pencil size={16} aria-hidden="true" /> Edit
                  </Link>
                  <Button onClick={() => start('confirmed')}>
                    <ClipboardCheck size={16} aria-hidden="true" /> Confirm Order
                  </Button>
                </>
              ) : (
                <Button onClick={() => start('fulfilled')}>
                  <CheckCheck size={16} aria-hidden="true" /> Mark as Fulfilled
                </Button>
              )}
            </>
          )
        }
      />
      {order.status === 'cancelled' && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          Cancelled: {order.cancelReason}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Order information">
          <DetailList
            items={[
              {
                label: 'Customer',
                value: canAccess(role, '/customers') ? (
                  <Link to={`/customers/${order.customerId}`} className={inlineLink}>
                    {order.customerName}
                  </Link>
                ) : (
                  order.customerName
                ),
              },
              {
                label: 'Property',
                value: order.propertyId && (
                  <Link to={`/properties/${order.propertyId}`} className={inlineLink}>
                    {order.propertyName}
                  </Link>
                ),
              },
              { label: 'Order date', value: formatDate(order.orderDate) },
              {
                label: 'Payment method',
                value: PAYMENT_METHODS.find((p) => p.value === order.paymentMethod)?.label,
              },
              ...(canWrite
                ? [
                    { label: 'Assigned to', value: order.assignedName },
                    {
                      label: 'Lead',
                      value: order.leadId && (
                        <Link to={`/leads/${order.leadId}`} className={inlineLink}>
                          View lead
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {order.notes && (
            <p className="mt-4 whitespace-pre-wrap border-t border-outline-variant pt-4 text-body-md text-on-surface">
              {order.notes}
            </p>
          )}
        </Panel>
        <Panel title="Order total">
          <OrderTotalsList
            totals={order}
            discountPercent={order.discountPercent}
            vatRate={order.vatRate}
          />
        </Panel>

        <Panel title="Products and services" className="lg:col-span-2">
          {order.items.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">This order has no lines.</p>
          ) : (
            <Table>
              <caption className="sr-only">Products and services</caption>
              <thead>
                <tr>
                  <Th>Product or service</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th className="text-right">Unit price</Th>
                  <Th className="text-right">Line total</Th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.description}</Td>
                    <Td className="whitespace-nowrap font-mono text-label-md">{i.sku ?? '-'}</Td>
                    <Td className="text-right">{formatNumber(i.quantity)}</Td>
                    <Td className="whitespace-nowrap text-right">{rand(i.unitPrice)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {rand(Math.round(i.quantity * i.unitPrice * 100) / 100)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        {canWrite && (
          <>
            <ActivitiesPanel subject={{ orderId: order.id }} />
            <TimelinePanel subject={{ orderId: order.id }} version={version} />
          </>
        )}
      </div>

      {next && (
        <ConfirmDialog
          open
          title={next.title}
          confirmLabel={next.label}
          busy={busy}
          error={error}
          onConfirm={() => void advance()}
          onCancel={() => setStep(null)}
        >
          <p>
            {order.reference}, {rand(order.total)}. {next.body}
          </p>
        </ConfirmDialog>
      )}
      {step === 'cancel' && (
        <ReasonDialog
          title="Cancel this order?"
          description="The order and its history are kept. A cancelled order cannot be reopened."
          confirmLabel="Cancel order"
          submit={(reason) => setOrderStatus(order.id, 'cancelled', reason)}
          onClose={() => setStep(null)}
          onDone={() => {
            setStep(null)
            onChanged('Order cancelled.')
          }}
        />
      )}
    </>
  )
}

export default function OrderDetailScreen() {
  const { id = '' } = useParams()
  return <OrderDetail key={id} id={id} />
}

function OrderDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const state = useResource(() => getOrder(id), `order-${id}`)

  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(order) => (
          <OrderBody
            order={order}
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
