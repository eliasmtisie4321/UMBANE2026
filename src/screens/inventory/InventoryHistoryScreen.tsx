import { useSearchParams } from 'react-router-dom'
import { ListPanel, SearchField } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { MovementTable } from '@/components/inventory/MovementTable'
import { Select } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { listMovements } from '@/services/inventory'
import { MOVEMENT_TYPES } from '@/types/inventory'
import { businessToday } from '@/utils/consumption'
import { PAGE_SIZE, patchParams, readEnum, readPage } from '@/utils/listParams'
import { PERIODS, periodRange, type Period } from '@/utils/period'

const TYPE_VALUES = MOVEMENT_TYPES.map((t) => t.value)
const PERIOD_VALUES = PERIODS.map((p) => p.value).filter((v): v is Exclude<Period, ''> => v !== '')

export default function InventoryHistoryScreen() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebouncedValue(q, 300)
  const type = readEnum(params, 'type', TYPE_VALUES)
  const period = readEnum(params, 'period', PERIOD_VALUES)
  const page = readPage(params)
  const range = periodRange(period, businessToday())
  const state = useResource(
    () =>
      listMovements(
        { search, sort: 'created_at', ascending: false, page, pageSize: PAGE_SIZE },
        { type, productId: '', ...range },
      ),
    JSON.stringify([search, type, range, page]),
  )
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

  return (
    <>
      <PageHeader
        title="Stock History"
        subtitle="Every stock movement, newest first. Movements are never edited or deleted."
        back={{ to: '/inventory', label: 'Inventory' }}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <SearchField
          id="movement-search"
          label="Search movements"
          placeholder="Product, SKU, order or reason"
          value={q}
          onChange={(v) => update({ q: v })}
        />
        <Select
          id="movement-type"
          label="Movement"
          options={[{ value: '', label: 'All movements' }, ...MOVEMENT_TYPES]}
          value={type}
          onChange={(e) => update({ type: e.target.value })}
        />
        <Select
          id="movement-period"
          label="Date"
          options={PERIODS}
          value={period}
          onChange={(e) => update({ period: e.target.value })}
        />
      </div>
      <ListPanel
        title="Movements"
        noun="movements"
        state={state}
        page={page}
        filtered={Boolean(q || type || period)}
        empty={<p>No stock has moved yet.</p>}
        onPage={(n) => update({ page: n })}
        onClear={() => setParams({}, { replace: true })}
      >
        {(rows) => <MovementTable rows={rows} />}
      </ListPanel>
    </>
  )
}
