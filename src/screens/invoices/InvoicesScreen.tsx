import { AlertTriangle, CheckCircle2, FileText, Plus, Settings, Wallet } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { StatTile } from '@/components/dashboard/StatTile'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { inlineLink, primaryLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge'
import { Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { getInvoiceSummary, listInvoices } from '@/services/invoices'
import { DISPLAY_STATUSES, type InvoiceSort } from '@/types/invoices'
import { businessToday } from '@/utils/consumption'
import { formatDate, formatNumber, formatRand } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'
import { PERIODS, periodRange, type Period } from '@/utils/period'

const SORTS = [
  'created_at',
  'issue_date',
  'due_date',
  'total',
  'balance',
] as const satisfies readonly InvoiceSort[]
const STATUS_VALUES = DISPLAY_STATUSES.map((s) => s.value)
const PERIOD_VALUES = PERIODS.map((p) => p.value).filter((v): v is Exclude<Period, ''> => v !== '')
const STATUS_FILTER = [{ value: '', label: 'All statuses' }, ...DISPLAY_STATUSES]
const PERIOD_FILTER = PERIODS.map((p) => (p.value === '' ? { ...p, label: 'All issue dates' } : p))
const money = (n: number) => formatRand(n, { cents: true })

export default function InvoicesScreen() {
  const { profile } = useAuth()
  const canWrite = profile !== null && canAccess(profile.role, '/invoices/new')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const status = readEnum(params, 'status', STATUS_VALUES)
  const period = readEnum(params, 'period', PERIOD_VALUES)
  const rawCustomer = params.get('customer') ?? ''
  const customerId = /^[0-9a-f-]{36}$/i.test(rawCustomer) ? rawCustomer : ''
  const { sort, ascending } = readSort(params, SORTS, 'created_at', false)
  const page = readPage(params)
  const range = periodRange(period, businessToday())

  const state = useResource(
    () =>
      listInvoices(
        { search, sort, ascending, page, pageSize: PAGE_SIZE },
        { status, customerId, ...range },
      ),
    JSON.stringify([search, status, customerId, range, sort, ascending, page]),
  )
  const summary = useResource(() => getInvoiceSummary(), 'invoice-summary')
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const sortHeader = (label: string, column: InvoiceSort) => (
    <SortableTh
      label={label}
      active={sort === column}
      ascending={ascending}
      onSort={() => {
        const next = nextSort({ sort, ascending }, column)
        update({ sort: next.sort, dir: next.dir })
      }}
    />
  )

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={canWrite ? 'Invoices, payments and what is still owed.' : 'Your invoices.'}
        actions={
          <>
            {profile && canAccess(profile.role, '/settings/invoicing') && (
              <Link to="/settings/invoicing" className={secondaryLink}>
                <Settings size={16} aria-hidden="true" /> Settings
              </Link>
            )}
            <Link to="/invoices/payments" className={secondaryLink}>
              <Wallet size={16} aria-hidden="true" /> Payment History
            </Link>
            {canWrite && (
              <Link
                to={customerId ? `/invoices/new?customer=${customerId}` : '/invoices/new'}
                className={primaryLink}
              >
                <Plus size={16} aria-hidden="true" /> Create Invoice
              </Link>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Outstanding"
          icon={Wallet}
          state={summary}
          map={(s) => ({
            value: money(s.outstanding),
            detail: `${formatNumber(s.unpaid + s.overdue)} unpaid ${s.unpaid + s.overdue === 1 ? 'invoice' : 'invoices'}`,
          })}
        />
        <StatTile
          label="Overdue"
          icon={AlertTriangle}
          state={summary}
          map={(s) => ({
            value: money(s.overdueAmount),
            detail: `${formatNumber(s.overdue)} past due`,
            tone: s.overdue > 0 ? 'error' : 'neutral',
          })}
        />
        <StatTile
          label="Paid invoices"
          icon={CheckCircle2}
          state={summary}
          map={(s) => ({
            value: formatNumber(s.paid),
            detail: `of ${formatNumber(s.issued)} issued`,
          })}
        />
        <StatTile
          label="Drafts"
          icon={FileText}
          state={summary}
          map={(s) => ({ value: formatNumber(s.drafts), detail: 'not yet issued' })}
        />
      </div>

      {customerId && (
        <p
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          <span>Showing the invoices of one customer.</span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => update({ customer: undefined })}
          >
            Show all invoices
          </button>
        </p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <SearchField
          id="invoice-search"
          label="Search invoices"
          placeholder="Invoice number, customer or order"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="invoice-status"
          label="Status"
          options={STATUS_FILTER}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
        <Select
          id="invoice-period"
          label="Issue date"
          options={PERIOD_FILTER}
          value={period}
          onChange={(e) => update({ period: e.target.value })}
        />
      </div>

      <ListPanel
        title="Invoice list"
        noun="invoices"
        state={state}
        page={page}
        filtered={Boolean(q || status || period || customerId)}
        empty={
          <>
            <p>There are no invoices yet.</p>
            {canWrite && (
              <Link to="/invoices/new" className={inlineLink}>
                Create the first invoice
              </Link>
            )}
          </>
        }
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Invoices</caption>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                {sortHeader('Issued', 'issue_date')}
                {sortHeader('Due', 'due_date')}
                {sortHeader('Total', 'total')}
                {sortHeader('Balance', 'balance')}
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <Td className="whitespace-nowrap">
                    <Link
                      to={`/invoices/${i.id}`}
                      className="font-mono text-label-md font-medium text-primary hover:underline"
                    >
                      {i.reference}
                    </Link>
                  </Td>
                  <Td>{i.customerName}</Td>
                  <Td className="whitespace-nowrap">
                    {i.issueDate ? formatDate(i.issueDate) : '-'}
                  </Td>
                  <Td className="whitespace-nowrap">{i.dueDate ? formatDate(i.dueDate) : '-'}</Td>
                  <Td className="whitespace-nowrap">{money(i.total)}</Td>
                  <Td className="whitespace-nowrap">
                    {i.status === 'draft' || i.status === 'cancelled' ? '-' : money(i.balance)}
                  </Td>
                  <Td>
                    <InvoiceStatusBadge status={i.displayStatus} />
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
