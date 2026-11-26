import { ArrowRight, Mail, Play, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { OnOffBadge, RunStatusText } from '@/components/automations/AutomationParts'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { listAutomations, runAutomationsNow, setAutomationEnabled } from '@/services/automations'
import { getEmailSetup } from '@/services/messages'
import { flushNotificationEmails } from '@/services/notifications'
import { AUTOMATIONS, type Automation, type AutomationInfo } from '@/types/automations'
import { formatDateTime } from '@/utils/format'

function Card({
  info,
  a,
  busy,
  onToggle,
}: {
  info: AutomationInfo
  a: Automation
  busy: boolean
  onToggle: () => void
}) {
  return (
    <li className="flex flex-col rounded-lg border border-outline-variant bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-title-md font-semibold text-on-surface">{info.name}</h3>
        <OnOffBadge enabled={a.enabled} />
      </div>
      <dl className="flex-1 space-y-2 text-body-md">
        <div>
          <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">
            When
          </dt>
          <dd className="text-on-surface">{info.trigger(a.settings)}</dd>
        </div>
        <div>
          <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">
            Then
          </dt>
          <dd className="text-on-surface">{info.action}</dd>
        </div>
        <div>
          <dt className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">
            Last run
          </dt>
          <dd className="text-on-surface">
            {info.timing === 'instant' ? (
              <span className="text-on-surface-variant">Acts the moment it happens</span>
            ) : a.lastRunAt ? (
              <>
                {formatDateTime(a.lastRunAt)} · <RunStatusText status={a.lastStatus} />
              </>
            ) : (
              <RunStatusText status={null} />
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant pt-3">
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          loading={busy}
          onClick={onToggle}
          aria-label={`${a.enabled ? 'Switch off' : 'Switch on'} ${info.name}`}
        >
          {a.enabled ? 'Switch off' : 'Switch on'}
        </Button>
        <Link
          to={`/automations/${info.key}`}
          className={`${inlineLink} inline-flex items-center gap-1 text-label-md`}
          aria-label={`Settings and history: ${info.name}`}
        >
          Settings and history <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}

/** The business's automations: switch them on or off, run the daily ones now. Managers only. */
export default function AutomationsScreen() {
  const [version, setVersion] = useState(0)
  const state = useResource(() => listAutomations(), `automations-${version}`)
  const email = useResource(() => getEmailSetup(), 'email-setup')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(a: Automation, info: AutomationInfo) {
    setBusyKey(a.key)
    setError(null)
    setNotice(null)
    const result = await setAutomationEnabled(a.key, !a.enabled)
    setBusyKey(null)
    if (!result.ok) return setError(result.error.message)
    setNotice(`${info.name} switched ${a.enabled ? 'off' : 'on'}.`)
    setVersion((v) => v + 1)
  }

  async function runNow() {
    setRunning(true)
    setError(null)
    setNotice(null)
    const result = await runAutomationsNow()
    setRunning(false)
    if (!result.ok) return setError(result.error.message)
    const total = (k: 'done' | 'skipped' | 'failed') => result.data.reduce((n, r) => n + r[k], 0)
    setNotice(
      result.data.length === 0
        ? 'No daily automations are switched on.'
        : `Ran ${result.data.length} daily automation${result.data.length === 1 ? '' : 's'}: ${total('done')} done, ${total('skipped')} skipped, ${total('failed')} failed.`,
    )
    void flushNotificationEmails()
    setVersion((v) => v + 1)
  }

  const groups: Array<{
    title: string
    icon: typeof Users
    note: string
    audience: 'team' | 'customers'
  }> = [
    {
      title: 'Team alerts',
      icon: Users,
      audience: 'team',
      note: 'Sent as notifications. Each person chooses in Notifications → Settings whether they also come by email.',
    },
    {
      title: 'Customer emails',
      icon: Mail,
      audience: 'customers',
      note: 'Off until you switch them on. Sent through the email queue, never to customers who opted out or whose email bounced.',
    },
  ]

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="Alerts for the team and emails to customers that run by themselves."
        actions={
          <Button onClick={() => void runNow()} loading={running}>
            <Play size={16} aria-hidden="true" /> Run Now
          </Button>
        }
      />
      <p className="mb-4 flex items-start gap-2 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
        <Zap size={18} className="mt-0.5 shrink-0 text-secondary" aria-hidden="true" />
        <span>
          Daily automations run every morning at 08:00 and when you press Run Now; the others act
          the moment something happens. Nothing is ever sent twice for the same thing.
        </span>
      </p>
      {email.data && !email.data.email && (
        <div
          role="status"
          className="mb-4 rounded-md bg-tertiary-container px-4 py-3 text-body-md text-on-tertiary-container"
        >
          Email is not set up yet, so customer emails and notification emails wait in the queue
          until it is (see docs/COMMUNICATIONS.md).
        </div>
      )}
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="Automations are not available yet. Run the latest database update (migration 0014)."
      >
        {(rows) => (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.title} aria-labelledby={`group-${g.audience}`}>
                <h2
                  id={`group-${g.audience}`}
                  className="flex items-center gap-2 text-title-lg font-semibold text-on-surface"
                >
                  <g.icon size={20} aria-hidden="true" className="text-secondary" /> {g.title}
                </h2>
                <p className="mb-3 text-body-md text-on-surface-variant">{g.note}</p>
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {AUTOMATIONS.filter((i) => i.audience === g.audience).map((info) => {
                    const a = rows.find((r) => r.key === info.key)
                    return a ? (
                      <Card
                        key={info.key}
                        info={info}
                        a={a}
                        busy={busyKey === info.key}
                        onToggle={() => void toggle(a, info)}
                      />
                    ) : null
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ResourceBoundary>
    </>
  )
}
