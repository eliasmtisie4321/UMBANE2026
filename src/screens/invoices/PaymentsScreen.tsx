import { Link, useSearchParams } from 'react-router-dom'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { SortableTh } from '@/components/data/SortableTh'
import { Select, Table, Td, Th } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { listPayments } from '@/services/invoices'
import { PAYMENT_METHOD_CODES, type PaymentSort } from '@/types/invoices'
import { businessToday } from '@/utils/consumption'
import { formatDate, formatRand } from '@/utils/format'
import { nextSort, PAGE_SIZE, patchParams, readEnum, readPage, readSort } from '@/utils/listParams'
import { PERIODS, periodRange, type Period } from '@/utils/period'

const SORTS = ['paid_at', 'amount', 'number'] as const satisfies readonly PaymentSort[]
const METHOD_VALUES = PAYMENT_METHOD_CODES.map((m) => m.value)
const PERIOD_VALUES = PERIODS.map((p) => p.value).filter((v): v is Exclude<Period, ''> => v !== '')
const METHOD_FILTER = [{ value: '', label: 'All methods' }, ...PAYMENT_METHOD_CODES]

export default function PaymentsScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const method = readEnum(params, 'method', METHOD_VALUES)
  const period = readEnum(params, 'period', PERIOD_VALUES)
  const { sort, ascending } = readSort(params, SORTS, 'paid_at', false)
  const page = readPage(params)
  const range = periodRange(period, businessToday())

  const state = useResource(
    () =>
      listPayments({ search, sort, ascending, page, pageSize: PAGE_SIZE }, { method, ...range }),
    JSON.stringify([search, method, range, sort, ascending, page]),
  )
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  const sortHeader = (label: string, column: PaymentSort) => (
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
        title="Payment History"
        subtitle="Money received against invoices."
        back={{ to: '/invoices', label: 'Invoices' }}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <SearchField
          id="payment-search"
          label="Search payments"
          placeholder="Payment, invoice, customer or reference"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="payment-method"
          label="Method"
          options={METHOD_FILTER}
          value={method}
          onChange={(e) => update({ method: e.target.value })}
        />
        <Select
          id="payment-period"
          label="Date received"
          options={PERIODS.map((p) => (p.value === '' ? { ...p, label: 'All payment dates' } : p))}
          value={period}
          onChange={(e) => update({ period: e.target.value })}
        />
      </div>
      <ListPanel
        title="Payments"
        noun="payments"
        state={state}
        page={page}
        filtered={Boolean(q || method || period)}
        empty={<p>No payments have been received yet.</p>}
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Payments</caption>
            <thead>
              <tr>
                {sortHeader('Payment', 'number')}
                <Th>Customer</Th>
                <Th>Invoice</Th>
                {sortHeader('Received', 'paid_at')}
                <Th>Method</Th>
                {sortHeader('Amount', 'amount')}
                <Th>Reference</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap font-mono text-label-md">{p.referenceNumber}</Td>
                  <Td>{p.customerName}</Td>
                  <Td className="whitespace-nowrap">
                    <Link
                      to={`/invoices/${p.invoiceId}`}
                      className="font-mono text-label-md text-secondary hover:underline"
                    >
                      {p.invoiceNumber ?? 'Invoice'}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                  <Td>{PAYMENT_METHOD_CODES.find((m) => m.value === p.method)?.label}</Td>
                  <Td className="whitespace-nowrap">{formatRand(p.amount, { cents: true })}</Td>
                  <Td>{p.reference ?? '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ListPanel>
    </>
  )
}
