import { Bell, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { cn } from '@/components/ui/cn'
import { useResource } from '@/hooks/useResource'
import { listNotifications, markRead, type AppNotification } from '@/services/notifications'
import { formatDateTime } from '@/utils/format'

/** The signed-in person's own notifications. Opening one marks it read and goes to its page. */
export default function NotificationsScreen() {
  const navigate = useNavigate()
  const [show, setShow] = useState<'unread' | 'all'>('unread')
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const state = useResource(
    () => listNotifications(show === 'unread'),
    `notifications-${show}-${version}`,
  )

  async function open(n: AppNotification) {
    if (!n.isRead) await markRead([n.id])
    if (n.link) navigate(n.link)
    else setVersion((v) => v + 1)
  }

  async function readAll() {
    setBusy(true)
    setError(null)
    const result = await markRead('all')
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setNotice('All notifications marked as read.')
    setVersion((v) => v + 1)
  }

  const unread = state.data?.filter((n) => !n.isRead).length ?? 0
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="New tickets, replies, assignments and status changes."
        actions={
          <Button
            variant="secondary"
            loading={busy}
            disabled={unread === 0}
            onClick={() => void readAll()}
          >
            <CheckCheck size={16} aria-hidden="true" /> Mark All as Read
          </Button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mb-4">
        <RadioGroup
          legend="Show"
          value={show}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
          onChange={setShow}
        />
      </div>
      <Panel title={show === 'unread' ? 'Unread' : 'All notifications'}>
        <ResourceBoundary
          state={state}
          isEmpty={(rows) => rows.length === 0}
          empty={show === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}
        >
          {(rows) => (
            <ul className="divide-y divide-outline-variant">
              {rows.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void open(n)}
                    className={cn(
                      'flex w-full items-start gap-3 px-2 py-3 text-left hover:bg-surface-container-low',
                      !n.isRead && 'bg-primary-container/30',
                    )}
                  >
                    <Bell
                      size={18}
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 shrink-0',
                        n.isRead ? 'text-outline' : 'text-secondary',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-md font-semibold text-on-surface">
                        {n.title}
                        {!n.isRead && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && (
                        <span className="block truncate text-body-md text-on-surface-variant">
                          {n.body}
                        </span>
                      )}
                      <span className="block text-label-md text-on-surface-variant">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ResourceBoundary>
      </Panel>
    </>
  )
}
