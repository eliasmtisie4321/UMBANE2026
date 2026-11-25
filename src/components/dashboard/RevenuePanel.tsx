import { useState } from 'react'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getRevenue } from '@/services/dashboard'
import type { PeriodMonths } from '@/types/dashboard'
import { formatDelta, formatRand, percentChange } from '@/utils/format'
import { Panel, ResourceBoundary } from './Panel'
import { RevenueChart } from './RevenueChart'

export function RevenuePanel({ months }: { months: PeriodMonths }) {
  const state = useResource(() => getRevenue(months), `revenue-${months}`)
  const [asTable, setAsTable] = useState(false)

  return (
    <Panel
      title="Revenue"
      subtitle="Payments received per month (ZAR)"
      className="lg:col-span-2"
      action={
        <Button
          variant="secondary"
          aria-pressed={asTable}
          onClick={() => setAsTable((t) => !t)}
          className="px-3 py-1.5"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </Button>
      }
    >
      <ResourceBoundary
        state={state}
        skeletonLines={5}
        isEmpty={(r) => r.total === 0 && r.previousTotal === 0}
        empty="No payments have been received in this period."
      >
        {(r) => {
          const change = percentChange(r.total, r.previousTotal)
          return (
            <>
              <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-headline-md font-bold text-on-surface">{formatRand(r.total)}</p>
                <p className="text-label-md text-on-surface-variant">
                  {change === null
                    ? `No payments in the previous ${months} months to compare with`
                    : `${formatDelta(change)} vs the previous ${months} months`}
                </p>
              </div>
              <RevenueChart points={r.points} asTable={asTable} />
            </>
          )
        }}
      </ResourceBoundary>
    </Panel>
  )
}
