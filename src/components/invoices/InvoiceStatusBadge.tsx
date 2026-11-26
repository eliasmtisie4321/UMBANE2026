import { Badge } from '@/components/ui'
import { DISPLAY_STATUSES, type DisplayStatus } from '@/types/invoices'

const TONE: Record<DisplayStatus, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  overdue: 'error',
  paid: 'success',
  cancelled: 'neutral',
}

/** Invoice status in words ("Unpaid" rather than "Sent"), never colour alone. */
export function InvoiceStatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Badge tone={TONE[status] ?? 'neutral'}>
      {DISPLAY_STATUSES.find((s) => s.value === status)?.label ?? status}
    </Badge>
  )
}
