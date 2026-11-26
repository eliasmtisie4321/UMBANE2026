import {
  Bell,
  Boxes,
  CheckCheck,
  ClipboardList,
  Headset,
  Receipt,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Select } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { cn } from '@/components/ui/cn'
import { useAuth } from '@/auth/useAuth'
import { useResource } from '@/hooks/useResource'
import { listNotifications, markRead, type AppNotification } from '@/services/notifications'
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/types/automations'
import { formatDateTime } from '@/utils/format'
import { patchParams, readEnum } from '@/utils/listParams'

const ICONS: Record<NotificationCategory, LucideIcon> = {
  tickets: Headset,
  tasks: ClipboardList,
  invoices: Receipt,
  inventory: Boxes,
  customers: Users,
  maintenance: Wrench,
  general: Bell,
}
const categoryLabel = (c: NotificationCategory) =>
  NOTIFICATION_CATEGORIES.find((x) => x.value === c)?.label ?? 'Other'

/** The signed-in person's own notifications. Opening one marks it read and goes to its page. */
export default function NotificationsScreen() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const show = readEnum(params, 'show', ['unread', 'all'] as const) || 'unread'
  const categories = NOTIFICATION_CATEGORIES.filter((c) => profile?.role !== 'client' || c.clients)
  const category = readEnum(
    params,
    'category',
    categories.map((c) => c.value),
  )
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const state = useResource(
    () => listNotifications({ unreadOnly: show === 'unread', category }),
    `notifications-${show}-${category}-${version}`,
  )
  const update = (patch: Record<string, string | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

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
  const label = category ? categoryLabel(category) : null
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Assignments, replies, status changes and alerts from automations."
        actions={
          <>
            <Link to="/notifications/settings" className={secondaryLink}>
              <Settings size={16} aria-hidden="true" /> Settings
            </Link>
            <Button
              variant="secondary"
              loading={busy}
              disabled={unread === 0}
              onClick={() => void readAll()}
            >
              <CheckCheck size={16} aria-hidden="true" /> Mark All as Read
            </Button>
          </>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <RadioGroup
          legend="Show"
          value={show}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
          onChange={(v) => update({ show: v === 'unread' ? undefined : v })}
        />
        <div className="w-52">
          <Select
            id="notification-category"
            label="About"
            value={category}
            options={[{ value: '', label: 'Everything' }, ...categories]}
            onChange={(e) => update({ category: e.target.value })}
          />
        </div>
      </div>
      <Panel
        title={`${show === 'unread' ? 'Unread' : 'All notifications'}${label ? `: ${label}` : ''}`}
      >
        <ResourceBoundary
          state={state}
          isEmpty={(rows) => rows.length === 0}
          empty={show === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}
        >
          {(rows) => (
            <ul className="divide-y divide-outline-variant">
              {rows.map((n) => {
                const Icon = ICONS[n.category]
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void open(n)}
                      className={cn(
                        'flex w-full items-start gap-3 px-2 py-3 text-left hover:bg-surface-container-low',
                        !n.isRead && 'bg-primary-container/30',
                      )}
                    >
                      <Icon
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
                          {categoryLabel(n.category)} · {formatDateTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ResourceBoundary>
      </Panel>
    </>
  )
}
