import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { inlineLink } from '@/components/data/linkStyles'
import { Badge, Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getActivities, getOpenActivities, getTimeline } from '@/services/salesActivities'
import {
  ACTIVITY_KINDS,
  LEAD_STATUSES,
  ORDER_STATUSES,
  type ActivitySubject,
  type HistorySubject,
  type SalesActivity,
} from '@/types/sales'
import { formatDate, formatDateTime, humanize } from '@/utils/format'
import { ActivityDialog } from './ActivityDialog'

const kindLabel = (kind: string) =>
  ACTIVITY_KINDS.find((k) => k.value === kind)?.label ?? humanize(kind)
const statusLabel = (s: string) =>
  [...LEAD_STATUSES, ...ORDER_STATUSES].find((x) => x.value === s)?.label ?? humanize(s)
const subjectKey = (s: HistorySubject) =>
  'leadId' in s
    ? `lead-${s.leadId}`
    : 'orderId' in s
      ? `order-${s.orderId}`
      : `invoice-${s.invoiceId}`

/** One history entry as a sentence. Payments carry their amount in the note. */
function describe(e: { fromStatus: string | null; toStatus: string; note: string | null }) {
  if (e.fromStatus === 'payment') return `Payment received: ${e.note ?? ''}`
  if (e.fromStatus === 'payment_removed') return `Payment removed: ${e.note ?? ''}`
  const what = e.fromStatus
    ? `${statusLabel(e.fromStatus)} to ${statusLabel(e.toStatus)}`
    : 'Created'
  return e.note ? `${what}: ${e.note}` : what
}

function ActivityRow({
  activity: a,
  showSubject = false,
  onOpen,
}: {
  activity: SalesActivity
  showSubject?: boolean
  onOpen: () => void
}) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="text-left text-body-md font-medium text-primary hover:underline"
        >
          {a.subject}
        </button>
        <Badge>{kindLabel(a.kind)}</Badge>
        {a.completedAt && <Badge tone="success">Done</Badge>}
        {a.isOverdue && <Badge tone="error">Overdue</Badge>}
      </div>
      {showSubject && a.subjectReference && (
        <Link
          to={a.leadId ? `/leads/${a.leadId}` : `/sales-orders/${a.orderId}`}
          className={`text-label-md ${inlineLink}`}
        >
          {[a.subjectReference, a.subjectName].filter(Boolean).join(' · ')}
        </Link>
      )}
      <p className="text-label-md text-on-surface-variant">
        {[
          a.completedAt
            ? `Done ${formatDateTime(a.completedAt)}`
            : a.dueOn
              ? `Due ${formatDate(a.dueOn)}`
              : 'No due date',
          a.assignedName ?? 'Not assigned',
        ].join(' · ')}
      </p>
      {a.outcome && <p className="text-body-md text-on-surface">{a.outcome}</p>}
    </li>
  )
}

/** Calls, meetings and tasks on one lead or order. */
export function ActivitiesPanel({ subject }: { subject: ActivitySubject }) {
  const state = useResource(() => getActivities(subject), `activities-${subjectKey(subject)}`)
  const [dialog, setDialog] = useState<SalesActivity | 'new' | null>(null)
  const saved = () => {
    setDialog(null)
    state.reload()
  }
  return (
    <Panel
      title="Activities"
      action={
        <Button variant="secondary" className="px-3 py-1.5" onClick={() => setDialog('new')}>
          <Plus size={16} aria-hidden="true" /> Add activity
        </Button>
      }
    >
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No calls, meetings or tasks yet."
      >
        {(rows) => (
          <ul className="divide-y divide-outline-variant">
            {rows.map((a) => (
              <ActivityRow key={a.id} activity={a} onOpen={() => setDialog(a)} />
            ))}
          </ul>
        )}
      </ResourceBoundary>
      {dialog === 'new' && (
        <ActivityDialog
          item={null}
          subject={subject}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog && dialog !== 'new' && (
        <ActivityDialog item={dialog} onClose={() => setDialog(null)} onSaved={saved} />
      )}
    </Panel>
  )
}

/** The signed-in person's open activities, or everyone's. */
export function OpenActivitiesPanel({ profileId }: { profileId: string }) {
  const [everyone, setEveryone] = useState(false)
  const who = everyone ? '' : profileId
  const state = useResource(() => getOpenActivities(who), `open-activities-${who}`)
  const [item, setItem] = useState<SalesActivity | null>(null)
  return (
    <Panel
      title={everyone ? 'Open activities' : 'My open activities'}
      subtitle="Soonest due first"
      className="mb-4"
      action={
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          aria-pressed={everyone}
          onClick={() => setEveryone((v) => !v)}
        >
          {everyone ? 'Show mine' : 'Show everyone’s'}
        </Button>
      }
    >
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty={
          everyone
            ? 'There are no open activities.'
            : 'Nothing is assigned to you. Add activities from a lead or an order.'
        }
      >
        {(rows) => (
          <ul className="divide-y divide-outline-variant">
            {rows.map((a) => (
              <ActivityRow key={a.id} activity={a} showSubject onOpen={() => setItem(a)} />
            ))}
          </ul>
        )}
      </ResourceBoundary>
      {item && (
        <ActivityDialog
          item={item}
          onClose={() => setItem(null)}
          onSaved={() => {
            setItem(null)
            state.reload()
          }}
        />
      )}
    </Panel>
  )
}

/** Every status change, newest first. `version` changes when the record is saved. */
export function TimelinePanel({ subject, version }: { subject: HistorySubject; version: number }) {
  const state = useResource(
    () => getTimeline(subject),
    `timeline-${subjectKey(subject)}-${version}`,
  )
  return (
    <Panel title="History">
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No changes have been recorded."
      >
        {(rows) => (
          <ol className="flex flex-col gap-3 border-l-2 border-outline-variant pl-4">
            {rows.map((e) => (
              <li key={e.id}>
                <p className="text-body-md text-on-surface">{describe(e)}</p>
                <p className="text-label-md text-on-surface-variant">
                  {formatDateTime(e.createdAt)} · {e.actorName ?? 'The system'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </ResourceBoundary>
    </Panel>
  )
}
