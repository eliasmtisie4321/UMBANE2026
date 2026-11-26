import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { OnOffBadge, OutcomeText, RunStatusText } from '@/components/automations/AutomationParts'
import { EmptyNotice, Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getAutomation,
  reasonText,
  saveAutomationSettings,
  setAutomationEnabled,
  type AutomationDetail,
} from '@/services/automations'
import { automationInfo, type AutomationAction, type AutomationInfo } from '@/types/automations'
import { settingsProblems } from '@/utils/automationForm'
import { ok } from '@/utils/result'
import { formatDateTime } from '@/utils/format'
import NotFoundScreen from '@/screens/NotFoundScreen'

const TARGET_LINK: Record<AutomationAction['targetType'], (id: string) => string> = {
  invoice: (id) => `/invoices/${id}`,
  product: (id) => `/inventory/${id}`,
  customer: (id) => `/customers/${id}`,
  ticket: (id) => `/support-tickets/${id}`,
  task: (id) => `/tasks/${id}`,
  maintenance: () => '/electricity-meters/maintenance',
}

function SettingsForm({
  info,
  detail,
  onSaved,
}: {
  info: AutomationInfo
  detail: AutomationDetail
  onSaved: (message: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      info.fields.map((f) => [f.name, String(detail.automation.settings[f.name] ?? '')]),
    ),
  )
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    const found = settingsProblems(info, values)
    setProblems(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    setError(null)
    const result = await saveAutomationSettings(
      info.key,
      Object.fromEntries(info.fields.map((f) => [f.name, Number(values[f.name])])),
    )
    setSaving(false)
    if (!result.ok) return setError(result.error.message)
    onSaved('Settings saved.')
  }

  const preview = Object.fromEntries(info.fields.map((f) => [f.name, Number(values[f.name]) || 0]))
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {error && (
        <div className="mb-3">
          <FormError>{error}</FormError>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {info.fields.map((f) => (
          <Input
            key={f.name}
            id={`setting-${f.name}`}
            label={`${f.label} (${f.unit})`}
            inputMode="numeric"
            value={values[f.name]}
            hint={f.hint}
            error={problems[f.name]}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        ))}
      </div>
      <p className="mt-3 text-body-md text-on-surface-variant">
        With these settings: <span className="text-on-surface">{info.trigger(preview)}</span>.
      </p>
      <Button type="submit" className="mt-4" loading={saving}>
        Save Settings
      </Button>
    </form>
  )
}

/** One automation: what it does, its settings, its recent runs and every action it took. */
export default function AutomationDetailScreen() {
  const { key = '' } = useParams()
  const info = automationInfo(key)
  const [version, setVersion] = useState(0)
  const state = useResource(
    () => (info ? getAutomation(key) : Promise.resolve(ok(null))),
    `automation-${key}-${version}`,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!info) return <NotFoundScreen />

  async function toggle(enabled: boolean) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await setAutomationEnabled(info!.key, !enabled)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setNotice(`Switched ${enabled ? 'off' : 'on'}.`)
    setVersion((v) => v + 1)
  }

  return (
    <>
      <PageHeader
        title={info.name}
        subtitle={info.audience === 'customers' ? 'Emails customers' : 'Alerts the team'}
        back={{ to: '/automations', label: 'Automations' }}
        actions={
          state.data && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void toggle(state.data!.automation.enabled)}
            >
              {state.data.automation.enabled ? 'Switch Off' : 'Switch On'}
            </Button>
          )
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <ResourceBoundary
        state={state}
        isEmpty={(d) => d === null}
        empty="This automation is not available."
      >
        {(d) => {
          const detail = d!
          const a = detail.automation
          return (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <Panel title="How it works" className="xl:col-span-1">
                <dl className="space-y-3 text-body-md">
                  <div>
                    <dt className="text-label-md font-semibold text-on-surface-variant">Status</dt>
                    <dd className="mt-1">
                      <OnOffBadge enabled={a.enabled} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-md font-semibold text-on-surface-variant">When</dt>
                    <dd className="text-on-surface">{info.trigger(a.settings)}</dd>
                  </div>
                  <div>
                    <dt className="text-label-md font-semibold text-on-surface-variant">Then</dt>
                    <dd className="text-on-surface">{info.action}</dd>
                  </div>
                  <div>
                    <dt className="text-label-md font-semibold text-on-surface-variant">Runs</dt>
                    <dd className="text-on-surface">
                      {info.timing === 'daily'
                        ? 'Every morning at 08:00, and when someone presses Run Now'
                        : 'The moment it happens'}
                    </dd>
                  </div>
                  {info.timing === 'daily' && (
                    <div>
                      <dt className="text-label-md font-semibold text-on-surface-variant">
                        Last run
                      </dt>
                      <dd className="text-on-surface">
                        {a.lastRunAt ? (
                          <>
                            {formatDateTime(a.lastRunAt)} · <RunStatusText status={a.lastStatus} />
                            {a.lastMessage && (
                              <span className="block text-label-md text-on-surface-variant">
                                {a.lastMessage}
                              </span>
                            )}
                          </>
                        ) : (
                          <RunStatusText status={null} />
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </Panel>
              <Panel title="Settings" className="xl:col-span-2">
                {info.fields.length === 0 ? (
                  <p className="text-body-md text-on-surface-variant">
                    This automation has nothing to set: switch it on or off.
                  </p>
                ) : (
                  <SettingsForm
                    key={JSON.stringify(a.settings)}
                    info={info}
                    detail={detail}
                    onSaved={(m) => {
                      setNotice(m)
                      setVersion((v) => v + 1)
                    }}
                  />
                )}
              </Panel>
              {info.timing === 'daily' && (
                <Panel title="Recent runs" subtitle="The last 20" className="xl:col-span-3">
                  {detail.runs.length === 0 ? (
                    <EmptyNotice>It has not run yet.</EmptyNotice>
                  ) : (
                    <Table>
                      <caption className="sr-only">Recent runs</caption>
                      <thead>
                        <tr>
                          <Th>Run</Th>
                          <Th>Started</Th>
                          <Th>How</Th>
                          <Th>Result</Th>
                          <Th className="text-right">Done</Th>
                          <Th className="text-right">Skipped</Th>
                          <Th className="text-right">Failed</Th>
                          <Th>Problem</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.runs.map((r) => (
                          <tr key={r.id}>
                            <Td className="whitespace-nowrap">RUN-{r.number}</Td>
                            <Td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</Td>
                            <Td>{r.trigger === 'manual' ? 'Run now' : 'Scheduled'}</Td>
                            <Td className="whitespace-nowrap">
                              <RunStatusText status={r.status} />
                            </Td>
                            <Td className="text-right">{r.done}</Td>
                            <Td className="text-right">{r.skipped}</Td>
                            <Td className="text-right">{r.failed}</Td>
                            <Td className="min-w-48 text-on-surface-variant">{r.error ?? '-'}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Panel>
              )}
              <Panel
                title="What it did"
                subtitle="The last 50 actions, newest first"
                className="xl:col-span-3"
              >
                {detail.actions.length === 0 ? (
                  <EmptyNotice>Nothing yet.</EmptyNotice>
                ) : (
                  <Table>
                    <caption className="sr-only">Actions taken</caption>
                    <thead>
                      <tr>
                        <Th>When</Th>
                        <Th>About</Th>
                        <Th>Result</Th>
                        <Th>Details</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.actions.map((x) => (
                        <tr key={x.id}>
                          <Td className="whitespace-nowrap">{formatDateTime(x.createdAt)}</Td>
                          <Td className="min-w-48">
                            {x.targetId ? (
                              <Link
                                to={TARGET_LINK[x.targetType](x.targetId)}
                                className={inlineLink}
                              >
                                {x.targetLabel ?? 'Open'}
                              </Link>
                            ) : (
                              (x.targetLabel ?? '-')
                            )}
                          </Td>
                          <Td className="whitespace-nowrap">
                            <OutcomeText outcome={x.outcome} />
                          </Td>
                          <Td className="min-w-48 text-on-surface-variant">
                            {reasonText(x.detail) || '-'}
                            {x.outcome === 'failed' && (
                              <span className="block text-label-md">
                                It will be tried again at the next run.
                              </span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Panel>
            </div>
          )
        }}
      </ResourceBoundary>
    </>
  )
}
