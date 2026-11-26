import { useState, type FormEvent } from 'react'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Button, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { listTaskUpdates, postTaskUpdate } from '@/services/tasks'
import { formatDateTime, formatNumber } from '@/utils/format'
import { validateUpdate } from '@/utils/teamForm'

interface Props {
  taskId: string
  canPost: boolean
  version: number
  onPosted: (notice: string) => void
}

/** Progress notes from the field, newest first. The author is whoever is signed in. */
export function TaskUpdatesPanel({ taskId, canPost, version, onPosted }: Props) {
  const updates = useResource(() => listTaskUpdates(taskId), `task-updates-${taskId}-${version}`)
  const [body, setBody] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const problem = validateUpdate(body)
    if (problem) return setFieldError(problem)
    setBusy(true)
    const result = await postTaskUpdate(taskId, body)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setBody('')
    onPosted('Progress update added.')
  }

  const count = updates.data?.length ?? 0
  return (
    <Panel
      title="Progress updates"
      subtitle={`${formatNumber(count)} ${count === 1 ? 'update' : 'updates'}`}
    >
      {canPost && (
        <form onSubmit={onSubmit} noValidate className="mb-4 flex flex-col gap-3">
          {error && <FormError>{error}</FormError>}
          <Textarea
            id="task-update"
            label="Add an update"
            hint="What was done, what is left, anything the team should know."
            rows={3}
            value={body}
            error={fieldError}
            onChange={(e) => {
              setBody(e.target.value)
              setFieldError(undefined)
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Post Update
            </Button>
          </div>
        </form>
      )}
      <ResourceBoundary state={updates} isEmpty={(r) => r.length === 0} empty="No updates yet.">
        {(rows) => (
          <ol className="flex flex-col gap-3" aria-label="Progress updates">
            {rows.map((u) => (
              <li
                key={u.id}
                className="rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3"
              >
                <p className="flex flex-wrap gap-x-2 text-label-md text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{u.authorName ?? 'Someone'}</span>
                  <span>{formatDateTime(u.createdAt)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-body-md">{u.body}</p>
              </li>
            ))}
          </ol>
        )}
      </ResourceBoundary>
    </Panel>
  )
}
