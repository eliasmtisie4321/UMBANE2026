import { useState } from 'react'
import { MonthlyChart } from '@/components/dashboard/MonthlyChart'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import type { Result } from '@/types/api'
import type { ConsumptionMonth } from '@/types/meters'
import { monthNote } from '@/utils/consumption'
import { formatCompact, formatKwh } from '@/utils/format'

interface ConsumptionPanelProps {
  load: () => Promise<Result<ConsumptionMonth[]>>
  resourceKey: string
  className?: string
}

export function ConsumptionPanel({ load, resourceKey, className }: ConsumptionPanelProps) {
  const state = useResource(load, resourceKey)
  const [asTable, setAsTable] = useState(false)

  return (
    <Panel
      title="Electricity consumption"
      subtitle="kWh per month, calculated from readings"
      className={className}
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
        isEmpty={(rows) => rows.length === 0}
        empty="Consumption appears once a meter has at least two readings."
      >
        {(rows) => (
          <>
            <MonthlyChart
              points={rows.map((r) => ({ month: r.month, total: r.kwh, note: monthNote(r) }))}
              asTable={asTable}
              measure="Consumption"
              caption="Electricity consumption per month"
              format={formatKwh}
              formatAxis={formatCompact}
            />
            <p className="mt-3 text-label-md text-on-surface-variant">
              Use between two readings is spread evenly over the days between them, so a recent
              month stays incomplete until the next reading.
            </p>
          </>
        )}
      </ResourceBoundary>
    </Panel>
  )
}
