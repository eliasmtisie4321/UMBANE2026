import { Building2, Gauge, PackageMinus, Receipt, Ticket, Users } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/auth/useAuth'
import {
  LowStockPanel,
  RecentActivityPanel,
  RecentInvoicesPanel,
  RecentPaymentsPanel,
} from '@/components/dashboard/ListPanels'
import { PeriodFilter } from '@/components/dashboard/PeriodFilter'
import { RevenuePanel } from '@/components/dashboard/RevenuePanel'
import { StatTile } from '@/components/dashboard/StatTile'
import { useResource } from '@/hooks/useResource'
import { getInvoiceSummary, getLowStock, getTicketSummary, getTotals } from '@/services/dashboard'
import { ROLE_LABEL } from '@/types/auth'
import type { InvoiceSummary, PeriodMonths, TicketSummary } from '@/types/dashboard'
import { formatNumber, formatRand } from '@/utils/format'

const invoiceTile = (s: InvoiceSummary) => ({
  value: formatRand(s.outstandingAmount),
  detail:
    s.outstandingCount === 0
      ? 'Nothing outstanding'
      : `${s.outstandingCount} ${s.outstandingCount === 1 ? 'invoice' : 'invoices'}${s.overdueCount > 0 ? ` · ${s.overdueCount} overdue` : ''}`,
  tone: s.overdueCount > 0 ? ('error' as const) : ('neutral' as const),
})

const ticketTile = (t: TicketSummary) => ({
  value: formatNumber(t.open),
  detail:
    t.open === 0
      ? 'No open tickets'
      : `${t.highPriority} high priority · ${t.openOverSevenDays} open over 7 days`,
  tone: t.highPriority > 0 ? ('warning' as const) : ('neutral' as const),
})

function BusinessOverview({ canSeeActivity }: { canSeeActivity: boolean }) {
  const [months, setMonths] = useState<PeriodMonths>(6)
  const totals = useResource(() => getTotals(), 'totals')
  const invoices = useResource(() => getInvoiceSummary(), 'invoice-summary')
  const tickets = useResource(() => getTicketSummary(), 'ticket-summary')
  const lowStock = useResource(() => getLowStock(), 'low-stock-tile')

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Total customers"
          icon={Users}
          state={totals}
          map={(t) => ({ value: formatNumber(t.customers) })}
        />
        <StatTile
          label="Total properties"
          icon={Building2}
          state={totals}
          map={(t) => ({ value: formatNumber(t.properties) })}
        />
        <StatTile
          label="Active meters"
          icon={Gauge}
          state={totals}
          map={(t) => ({ value: formatNumber(t.activeMeters) })}
        />
        <StatTile label="Outstanding invoices" icon={Receipt} state={invoices} map={invoiceTile} />
        <StatTile label="Open support tickets" icon={Ticket} state={tickets} map={ticketTile} />
        <StatTile
          label="Low stock"
          icon={PackageMinus}
          state={lowStock}
          map={(s) => ({
            value: formatNumber(s.count),
            detail:
              s.count === 0
                ? 'All products stocked'
                : `Lowest: ${s.items[0]?.name ?? 'unknown'} (${s.items[0]?.stockOnHand ?? 0} left)`,
            tone: s.count > 0 ? 'warning' : 'neutral',
          })}
        />
      </div>

      <div className="mt-8 mb-4 flex flex-wrap items-center gap-3">
        <span className="text-label-md font-medium text-on-surface-variant">Date range</span>
        <PeriodFilter value={months} onChange={setMonths} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RevenuePanel months={months} />
        <LowStockPanel />
        <RecentPaymentsPanel months={months} />
        {canSeeActivity && <RecentActivityPanel />}
      </div>
    </>
  )
}

function ClientOverview() {
  const totals = useResource(() => getTotals(), 'client-totals')
  const invoices = useResource(() => getInvoiceSummary(), 'client-invoice-summary')
  const tickets = useResource(() => getTicketSummary(), 'client-ticket-summary')

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Outstanding balance" icon={Receipt} state={invoices} map={invoiceTile} />
        <StatTile
          label="Open support tickets"
          icon={Ticket}
          state={tickets}
          map={(t) => ({
            value: formatNumber(t.open),
            detail: t.open === 0 ? 'No open tickets' : undefined,
          })}
        />
        <StatTile
          label="Your properties"
          icon={Building2}
          state={totals}
          map={(t) => ({ value: formatNumber(t.properties) })}
        />
        <StatTile
          label="Your meters"
          icon={Gauge}
          state={totals}
          map={(t) => ({ value: formatNumber(t.activeMeters) })}
        />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RecentInvoicesPanel />
      </div>
    </>
  )
}

export default function OverviewScreen() {
  const { profile } = useAuth()
  if (!profile) return null
  const first = profile.full_name.split(' ')[0]
  const isClient = profile.role === 'client'

  return (
    <>
      <h1 className="mb-1 text-headline-lg font-bold text-primary">
        {first ? `Welcome, ${first}` : 'Welcome'}
      </h1>
      <p className="mb-6 text-on-surface-variant">
        {isClient ? 'Your account at a glance' : `Business overview · ${ROLE_LABEL[profile.role]}`}
      </p>
      {isClient ? (
        <ClientOverview />
      ) : (
        <BusinessOverview
          canSeeActivity={profile.role === 'administrator' || profile.role === 'manager'}
        />
      )}
    </>
  )
}
