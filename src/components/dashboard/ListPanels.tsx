import { Badge, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getLowStock,
  getRecentActivity,
  getRecentInvoices,
  getRecentPayments,
} from '@/services/dashboard'
import type { PeriodMonths } from '@/types/dashboard'
import { describeActivity } from '@/utils/activity'
import { formatDate, formatRand } from '@/utils/format'
import { Panel, ResourceBoundary } from './Panel'

export function LowStockPanel() {
  const state = useResource(() => getLowStock(), 'low-stock')
  return (
    <Panel title="Low stock" subtitle="At or below the reorder level">
      <ResourceBoundary
        state={state}
        isEmpty={(s) => s.count === 0}
        empty="No products are running low."
      >
        {(s) => (
          <>
            <ul className="divide-y divide-outline-variant">
              {s.items.map((item) => (
                <li key={item.productId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-body-md font-medium text-on-surface">{item.name}</p>
                    <p className="font-mono text-label-sm text-on-surface-variant">{item.sku}</p>
                  </div>
                  <p className="shrink-0 text-right text-label-md text-on-surface-variant">
                    <span className="font-semibold text-on-surface tabular-nums">
                      {item.stockOnHand}
                    </span>{' '}
                    left
                    <span className="block text-label-sm">reorder at {item.threshold}</span>
                  </p>
                </li>
              ))}
            </ul>
            {s.count > s.items.length && (
              <p className="mt-2 text-label-md text-on-surface-variant">
                and {s.count - s.items.length} more
              </p>
            )}
          </>
        )}
      </ResourceBoundary>
    </Panel>
  )
}

export function RecentPaymentsPanel({ months }: { months: PeriodMonths }) {
  const state = useResource(() => getRecentPayments(months), `payments-${months}`)
  return (
    <Panel title="Recent payments" subtitle={`Last ${months} months`} className="lg:col-span-2">
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No payments in this period."
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Most recent payments</caption>
            <thead>
              <tr>
                <Th>Customer</Th>
                {/* Invoice number is the first column to go on a phone so date and amount never wrap. */}
                <Th className="hidden sm:table-cell">Invoice</Th>
                <Th className="whitespace-nowrap">Date</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td>{p.customerName ?? 'Unknown'}</Td>
                  <Td className="hidden font-mono text-label-md sm:table-cell">
                    {p.invoiceNumber ?? '-'}
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(p.paidAt)}</Td>
                  <Td className="text-right font-medium whitespace-nowrap">
                    {formatRand(p.amount, { cents: true })}
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

export function RecentActivityPanel() {
  const state = useResource(() => getRecentActivity(), 'activity')
  return (
    <Panel title="Recent activity" subtitle="Latest changes in your business">
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No activity recorded yet."
      >
        {(rows) => (
          <ul className="divide-y divide-outline-variant">
            {rows.map((a) => (
              <li key={a.id} className="py-2.5">
                <p className="text-body-md text-on-surface">{describeActivity(a)}</p>
                <p className="text-label-sm text-on-surface-variant">{formatDate(a.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </ResourceBoundary>
    </Panel>
  )
}

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'error',
  cancelled: 'neutral',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Part paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

export function RecentInvoicesPanel() {
  const state = useResource(() => getRecentInvoices(), 'recent-invoices')
  return (
    <Panel title="Your invoices" subtitle="Most recent first" className="lg:col-span-3">
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="You have no invoices yet."
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Your most recent invoices</caption>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id}>
                  <Td className="font-mono text-label-md whitespace-nowrap">{inv.invoiceNumber}</Td>
                  <Td className="whitespace-nowrap">
                    {inv.dueDate ? formatDate(inv.dueDate) : '-'}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={inv.isOverdue ? 'error' : (STATUS_TONE[inv.status] ?? 'neutral')}>
                      {inv.isOverdue ? 'Overdue' : (STATUS_LABEL[inv.status] ?? inv.status)}
                    </Badge>
                  </Td>
                  <Td className="text-right font-medium whitespace-nowrap">
                    {formatRand(inv.balance, { cents: true })}
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
