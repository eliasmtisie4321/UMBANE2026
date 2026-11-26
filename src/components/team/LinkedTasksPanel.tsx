import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { secondaryLink } from '@/components/data/linkStyles'
import { useResource } from '@/hooks/useResource'
import { listTasks } from '@/services/tasks'
import { formatDate } from '@/utils/format'
import { TaskStatusBadge } from './TeamBadges'

/** Field work for a ticket. Staff see the tasks assigned to them; managers see all of them. */
export function LinkedTasksPanel({
  ticketId,
  canCreate,
}: {
  ticketId: string
  canCreate: boolean
}) {
  const tasks = useResource(
    () =>
      listTasks(
        { search: '', sort: 'created_at', ascending: false, page: 1, pageSize: 20 },
        { status: '', category: '', priority: '', assignee: '', ticketId },
      ),
    `ticket-tasks-${ticketId}`,
  )
  return (
    <Panel
      title="Tasks"
      action={
        canCreate ? (
          <Link to={`/tasks/new?ticket=${ticketId}`} className={secondaryLink}>
            <Plus size={16} aria-hidden="true" /> Create Task
          </Link>
        ) : undefined
      }
    >
      <ResourceBoundary
        state={tasks}
        isEmpty={(p) => p.rows.length === 0}
        empty="No tasks for this ticket."
      >
        {(page) => (
          <ul className="divide-y divide-outline-variant" aria-label="Tasks for this ticket">
            {page.rows.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link
                    to={`/tasks/${t.id}`}
                    className="text-body-md font-medium text-primary hover:underline"
                  >
                    {t.title}
                  </Link>
                  <p className="text-label-md text-on-surface-variant">
                    {[t.assigneeName ?? 'Nobody yet', t.dueDate && `due ${formatDate(t.dueDate)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <TaskStatusBadge status={t.displayStatus} />
              </li>
            ))}
          </ul>
        )}
      </ResourceBoundary>
    </Panel>
  )
}
