import { Ban, CheckCircle2, Pause, Pencil, Play, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { ActivityPanel, FilesPanel } from '@/components/data/FilesPanel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { ReasonDialog } from '@/components/sales/ReasonDialog'
import { TicketPriorityBadge } from '@/components/support/TicketBadges'
import { TaskStatusBadge } from '@/components/team/TeamBadges'
import { TaskUpdatesPanel } from '@/components/team/TaskUpdatesPanel'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getTask,
  listTaskEvents,
  listTaskFiles,
  setTaskStatus,
  taskFileUrls,
  uploadTaskFile,
} from '@/services/tasks'
import { labelOf } from '@/types/support'
import { TASK_CATEGORIES, type Task, type TaskStatus } from '@/types/team'
import { TASK_FILES } from '@/utils/files'
import { formatDate, formatDateTime } from '@/utils/format'
import { describeTaskEvent, taskActions } from '@/utils/teamForm'

function TaskBody({
  task: t,
  version,
  onChanged,
}: {
  task: Task
  version: number
  onChanged: (notice: string) => void
}) {
  const { profile } = useAuth()
  const role = profile?.role ?? 'staff'
  const isManager = canAccess(role, '/tasks/new')
  const can = taskActions(t, { id: profile?.id ?? '', isManager })
  const [dialog, setDialog] = useState<'complete' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsPhoto = t.proofRequired && t.photoCount === 0

  async function move(status: TaskStatus, notice: string) {
    setBusy(true)
    setError(null)
    const result = await setTaskStatus(t.id, status)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setDialog(null)
    onChanged(notice)
  }

  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-on-surface">{t.reference}</span>
            <TaskStatusBadge status={t.displayStatus} />
            <TicketPriorityBadge priority={t.priority} />
            <span>
              {t.assigneeName ? `Assigned to ${t.assigneeName}` : 'Not assigned'}
              {t.dueDate && ` · Due ${formatDate(t.dueDate)}`}
            </span>
          </span>
        }
        back={{ to: '/tasks', label: isManager ? 'Task Management' : 'My Tasks' }}
        actions={
          <>
            {can.edit && (
              <Link to={`/tasks/${t.id}/edit`} className={secondaryLink}>
                <Pencil size={16} aria-hidden="true" /> Edit
              </Link>
            )}
            {can.cancel && (
              <Button variant="secondary" onClick={() => setDialog('cancel')}>
                <Ban size={16} aria-hidden="true" /> Cancel Task
              </Button>
            )}
            {can.reopen && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void move(t.assignedTo ? 'in_progress' : 'todo', 'Task reopened.')}
              >
                <RotateCcw size={16} aria-hidden="true" /> Reopen
              </Button>
            )}
            {can.pause && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void move('todo', 'Task moved back to Pending.')}
              >
                <Pause size={16} aria-hidden="true" /> Back to Pending
              </Button>
            )}
            {can.start && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void move('in_progress', 'Work started.')}
              >
                <Play size={16} aria-hidden="true" /> Start Work
              </Button>
            )}
            {can.complete && (
              <Button
                onClick={() => {
                  setError(null)
                  setDialog('complete')
                }}
              >
                <CheckCircle2 size={16} aria-hidden="true" /> Mark Complete
              </Button>
            )}
          </>
        }
      />
      {error && dialog === null && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      {t.status === 'cancelled' && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          Cancelled: {t.cancelReason}
        </p>
      )}
      {needsPhoto && (t.status === 'todo' || t.status === 'in_progress') && (
        <p className="mb-4 rounded-md bg-tertiary-container px-4 py-3 text-body-md text-on-tertiary-container">
          This task needs a photo of the finished work before it can be completed.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Panel title="Details" subtitle={labelOf(TASK_CATEGORIES, t.category)}>
            <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
              {t.description || 'No description.'}
            </p>
          </Panel>
          <TaskUpdatesPanel
            taskId={t.id}
            canPost={can.post}
            version={version}
            onPosted={onChanged}
          />
          <FilesPanel
            title="Proof of work"
            source={{
              key: `task-${t.id}`,
              list: () => listTaskFiles(t.id),
              urls: (paths) => taskFileUrls(paths),
              upload: (file) =>
                uploadTaskFile({ id: t.id, businessId: profile?.business_id ?? '' }, file),
              rules: TASK_FILES,
            }}
            canUpload={can.post}
            version={version}
            onUploaded={onChanged}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Summary">
            <DetailList
              items={[
                { label: 'Assigned to', value: t.assigneeName ?? 'Nobody yet' },
                { label: 'Created by', value: t.createdByName },
                {
                  label: 'Customer',
                  value:
                    t.customerId &&
                    (canAccess(role, '/customers') ? (
                      <Link to={`/customers/${t.customerId}`} className={inlineLink}>
                        {t.customerName}
                      </Link>
                    ) : (
                      t.customerName
                    )),
                },
                {
                  label: 'Property',
                  value: t.propertyId && (
                    <Link to={`/properties/${t.propertyId}`} className={inlineLink}>
                      {t.propertyName}
                    </Link>
                  ),
                },
                {
                  label: 'Ticket',
                  value: t.ticketId && (
                    <Link to={`/support-tickets/${t.ticketId}`} className={inlineLink}>
                      {t.ticketReference}
                    </Link>
                  ),
                },
                { label: 'Start date', value: t.startDate && formatDate(t.startDate) },
                {
                  label: 'Due date',
                  value: t.dueDate && (
                    <span className={t.isOverdue ? 'font-medium text-error' : undefined}>
                      {formatDate(t.dueDate)}
                      {t.isOverdue && ' (overdue)'}
                    </span>
                  ),
                },
                { label: 'Started', value: t.startedAt && formatDateTime(t.startedAt) },
                {
                  label: 'Completed',
                  value:
                    t.completedAt &&
                    `${formatDateTime(t.completedAt)}${t.completedByName ? ` by ${t.completedByName}` : ''}`,
                },
                { label: 'Proof photo', value: t.proofRequired ? 'Required' : 'Not required' },
              ]}
            />
          </Panel>
          <ActivityPanel
            load={() => listTaskEvents(t.id)}
            loadKey={`task-events-${t.id}-${version}`}
            describe={describeTaskEvent}
            label="Task activity"
          />
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'complete'}
        title="Mark this task complete?"
        confirmLabel="Mark complete"
        busy={busy}
        error={error}
        onConfirm={() => void move('done', 'Task completed.')}
        onCancel={() => setDialog(null)}
      >
        <p>
          {needsPhoto
            ? 'This task needs a photo of the finished work first. Attach one under Proof of work.'
            : 'The completion time and your name are recorded, and whoever created the task is told.'}
        </p>
      </ConfirmDialog>
      {dialog === 'cancel' && (
        <ReasonDialog
          title="Cancel this task?"
          description="The task stays on record as cancelled, and the person assigned is told."
          confirmLabel="Cancel task"
          submit={(reason) => setTaskStatus(t.id, 'cancelled', reason)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            onChanged('Task cancelled.')
          }}
        />
      )}
    </>
  )
}

export default function TaskDetailScreen() {
  const { id = '' } = useParams()
  return <TaskDetail key={id} id={id} />
}

function TaskDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const state = useResource(() => getTask(id), `task-${id}`)
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(task) => (
          <TaskBody
            task={task}
            version={version}
            onChanged={(text) => {
              setNotice(text)
              setVersion((v) => v + 1)
              state.reload()
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
