import { Badge } from '@/components/ui'
import { labelOf } from '@/types/support'
import { MESSAGE_STATUSES, type MessageStatus } from '@/types/messages'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const TONE: Record<MessageStatus, Tone> = {
  queued: 'info',
  sending: 'info',
  sent: 'info',
  delivered: 'success',
  delayed: 'warning',
  bounced: 'error',
  complained: 'error',
  failed: 'error',
  cancelled: 'neutral',
  logged: 'neutral',
}

/** Always a word, never colour alone. */
export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <Badge tone={TONE[status] ?? 'neutral'}>{labelOf(MESSAGE_STATUSES, status)}</Badge>
}
