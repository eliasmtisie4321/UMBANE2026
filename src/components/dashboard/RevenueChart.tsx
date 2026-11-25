import type { RevenuePoint } from '@/types/dashboard'
import { formatRand, formatRandCompact } from '@/utils/format'
import { MonthlyChart } from './MonthlyChart'

interface RevenueChartProps {
  points: RevenuePoint[]
  /** Show the data as a table instead of the chart. */
  asTable?: boolean
}

export function RevenueChart({ points, asTable }: RevenueChartProps) {
  return (
    <MonthlyChart
      points={points}
      asTable={asTable}
      measure="Revenue"
      caption="Revenue received per month"
      format={formatRand}
      formatAxis={formatRandCompact}
    />
  )
}
