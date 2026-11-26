import { Badge } from '@/components/ui'
import { labelOf } from '@/types/support'
import { EMPLOYMENT_STATUSES, type EmploymentStatus, type TaskDisplayStatus } from '@/types/team'
import { statusLabel } from '@/utils/teamForm'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

/** Inactive (no access) wins over the employment status. Always a word, never colour alone. */
export function EmployeeStatusBadge({
  status,
  isActive,
}: {
  status: EmploymentStatus
  isActive: boolean
}) {
  if (!isActive) return <Badge tone="neutral">Inactive</Badge>
  const tone: Tone = status === 'active' ? 'success' : status === 'on_leave' ? 'warning' : 'info'
  return <Badge tone={tone}>{labelOf(EMPLOYMENT_STATUSES, status)}</Badge>
}

const TASK_TONE: Record<TaskDisplayStatus, Tone> = {
  todo: 'info',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'neutral',
  overdue: 'error',
}

export function TaskStatusBadge({ status }: { status: TaskDisplayStatus }) {
  return <Badge tone={TASK_TONE[status] ?? 'neutral'}>{statusLabel(status)}</Badge>
}
