import { Link } from 'react-router-dom'
import { inlineLink } from '@/components/data/linkStyles'
import { Table, Td, Th } from '@/components/ui'
import { MOVEMENT_TYPES, type Movement } from '@/types/inventory'
import { formatDateTime, formatNumber } from '@/utils/format'

const signed = (n: number) => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n))

/** Stock movements with the count before and after each one. */
export function MovementTable({
  rows,
  showProduct = true,
}: {
  rows: Movement[]
  showProduct?: boolean
}) {
  return (
    <Table>
      <caption className="sr-only">Stock movements</caption>
      <thead>
        <tr>
          <Th>Date</Th>
          {showProduct && <Th>Product</Th>}
          <Th>Movement</Th>
          <Th className="text-right">Before</Th>
          <Th className="text-right">Change</Th>
          <Th className="text-right">After</Th>
          <Th>Reference or reason</Th>
          <Th>By</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</Td>
            {showProduct && (
              <Td>
                <Link to={`/inventory/${m.productId}`} className={inlineLink}>
                  {m.productName}
                </Link>
                <span className="block font-mono text-label-sm text-on-surface-variant">
                  {m.sku}
                </span>
              </Td>
            )}
            <Td className="whitespace-nowrap">
              {MOVEMENT_TYPES.find((t) => t.value === m.type)?.label ?? m.type}
            </Td>
            <Td className="text-right">{formatNumber(m.balanceBefore)}</Td>
            <Td
              className={`whitespace-nowrap text-right font-semibold ${m.quantity < 0 ? 'text-error' : 'text-success'}`}
            >
              {signed(m.quantity)}
            </Td>
            <Td className="text-right">{formatNumber(m.balanceAfter)}</Td>
            <Td>
              {m.orderId && m.orderReference ? (
                <Link to={`/sales-orders/${m.orderId}`} className={`font-mono ${inlineLink}`}>
                  {m.orderReference}
                </Link>
              ) : (
                (m.note ?? '-')
              )}
            </Td>
            <Td className="whitespace-nowrap">{m.recordedByName ?? 'The system'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
