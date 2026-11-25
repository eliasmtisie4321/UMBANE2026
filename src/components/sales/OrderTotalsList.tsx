import { formatRand } from '@/utils/format'
import type { OrderTotals } from '@/utils/orderMath'

interface OrderTotalsListProps {
  totals: OrderTotals
  discountPercent: string | number
  vatRate: string | number
}

export function OrderTotalsList({ totals, discountPercent, vatRate }: OrderTotalsListProps) {
  const rand = (n: number) => formatRand(n, { cents: true })
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-body-md text-on-surface-variant">{label}</dt>
      <dd className="text-body-md text-on-surface tabular-nums">{value}</dd>
    </div>
  )
  return (
    <dl className="flex flex-col gap-2">
      {row('Subtotal', rand(totals.subtotal))}
      {row(
        `Discount (${discountPercent}%)`,
        totals.discount === 0 ? rand(0) : rand(-totals.discount),
      )}
      {row(`VAT (${vatRate}%)`, rand(totals.tax))}
      <div className="flex items-baseline justify-between gap-4 border-t border-outline-variant pt-2">
        <dt className="text-title-md font-semibold text-on-surface">Total</dt>
        <dd className="text-title-md font-bold text-on-surface tabular-nums">
          {rand(totals.total)}
        </dd>
      </div>
    </dl>
  )
}
