import { Badge } from '@/components/ui'
import {
  labelOf,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from '@/types/support'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const STATUS_TONE: Record<TicketStatus, Tone> = {
  open: 'info',
  assigned: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
}
const PRIORITY_TONE: Record<TicketPriority, Tone> = {
  urgent: 'error',
  high: 'warning',
  normal: 'neutral',
  low: 'neutral',
}

/** Always a word, never colour alone. */
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{labelOf(TICKET_STATUSES, status)}</Badge>
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'}>
      {labelOf(TICKET_PRIORITIES, priority)}
    </Badge>
  )
}
