import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CAPABILITY_LABEL,
  CHANNEL_LABEL,
  GROUP_LABEL,
  PROVIDERS,
  fieldProblem,
  providerInfo,
  type Field,
  type ProviderGroup,
  type ProviderInfo,
} from '@shared/integrations'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Badge, Button, Input, Modal, Select } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { navigation } from '@/utils/browser'
import {
  callbackNotice,
  connectWithKeys,
  disconnectIntegration,
  getIntegrations,
  setDefaultIntegration,
  startOAuth,
  testIntegration,
  updateIntegrationSettings,
} from '@/services/integrations'
import type {
  IntegrationConnection,
  IntegrationsOverview,
  ProviderReadiness,
} from '@/types/integrations'

const GROUPS: ProviderGroup[] = ['email', 'messaging', 'social']

/**
 * Settings → Integrations: every outside service Umbane uses, in one place. Administrators connect
 * each one (with keys from the provider, or by signing in with it), test it, choose the default per
 * channel, change its options and disconnect it. A provider shows as connected only after it
 * confirmed the connection; what it can do is what it confirmed.
 */
export default function IntegrationsScreen() {
  const [version, setVersion] = useState(0)
  const [params] = useSearchParams()
  const [notice, setNotice] = useState(() =>
    callbackNotice(params, (k) => providerInfo(k)?.label ?? k),
  )
  const state = useResource(() => getIntegrations(), `integrations-${version}`)
  const changed = (text: string, tone: 'success' | 'error' = 'success') => {
    setNotice({ tone, text })
    setVersion((v) => v + 1)
  }
  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect email, SMS, WhatsApp and social media accounts. Every Share and Send in Umbane uses these."
        back={{ to: '/settings', label: 'Settings' }}
      />
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-md px-4 py-3 text-body-md ${notice.tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface'}`}
        >
          {notice.text}
        </p>
      )}
      <ResourceBoundary state={state} skeletonLines={8}>
        {(data) => <Overview data={data} onChanged={changed} />}
      </ResourceBoundary>
    </>
  )
}

function Overview({
  data,
  onChanged,
}: {
  data: IntegrationsOverview
  onChanged: (text: string, tone?: 'success' | 'error') => void
}) {
  const connected = data.connections.filter((c) => c.status === 'connected')
  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="builtin-email"
        className="rounded-lg border border-outline-variant bg-surface p-4 shadow-card"
      >
        <h2 id="builtin-email" className="text-title-md font-semibold text-on-surface">
          Built-in email
        </h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          {data.builtInEmail.ready
            ? `Set up on the server (Resend, sending as ${data.builtInEmail.from}). Used when no email account is connected below.`
            : 'Not set up on the server. Connect an email account below, or set RESEND_API_KEY and EMAIL_FROM in Vercel.'}
        </p>
      </section>
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className="mb-3 text-title-md font-semibold text-on-surface">
            {GROUP_LABEL[group]}
          </h2>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PROVIDERS.filter((p) => p.group === group).map((p) => (
              <ProviderCard
                key={p.key}
                info={p}
                readiness={
                  data.providers.find((r) => r.key === p.key) ?? {
                    key: p.key,
                    ready: false,
                    missing: [],
                  }
                }
                connection={data.connections.find((c) => c.provider === p.key) ?? null}
                othersOnChannel={
                  connected.filter((c) => c.channel === p.channel && c.provider !== p.key).length
                }
                onChanged={onChanged}
              />
            ))}
          </ul>
        </section>
      ))}
      {data.redirectUri && (
        <p className="text-label-md text-on-surface-variant">
          For Google, Microsoft, Meta and LinkedIn, the sign-in return address registered with each
          provider is <code className="font-mono">{data.redirectUri}</code>.
        </p>
      )}
    </div>
  )
}

function statusOf(
  info: ProviderInfo,
  readiness: ProviderReadiness,
  c: IntegrationConnection | null,
) {
  if (info.connect === 'unavailable') return { tone: 'neutral' as const, label: 'Not available' }
  if (c?.status === 'connected') return { tone: 'success' as const, label: 'Connected' }
  if (c?.status === 'error') return { tone: 'warning' as const, label: 'Needs attention' }
  if (!readiness.ready) return { tone: 'neutral' as const, label: 'Server setup needed' }
  return { tone: 'neutral' as const, label: 'Not connected' }
}

function ProviderCard({
  info,
  readiness,
  connection,
  othersOnChannel,
  onChanged,
}: {
  info: ProviderInfo
  readiness: ProviderReadiness
  connection: IntegrationConnection | null
  othersOnChannel: number
  onChanged: (text: string, tone?: 'success' | 'error') => void
}) {
  const [dialog, setDialog] = useState<'connect' | 'settings' | 'disconnect' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const status = statusOf(info, readiness, connection)
  const titleId = `provider-${info.key}`

  async function connect() {
    if (info.connect === 'api_key') return setDialog('connect')
    setBusy('connect')
    setError(null)
    const r = await startOAuth(info.key)
    setBusy(null)
    if (r.ok) navigation.go(r.data.url)
    else setError(r.error.message)
  }

  async function run(
    what: string,
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    done: string,
  ) {
    setBusy(what)
    setError(null)
    const r = await action()
    setBusy(null)
    if (r.ok) onChanged(done)
    else setError(r.error?.message ?? 'Something went wrong.')
  }

  async function test(sendTest: boolean) {
    if (!connection) return
    setBusy(sendTest ? 'testmail' : 'test')
    setError(null)
    const r = await testIntegration(connection.id, sendTest)
    setBusy(null)
    if (!r.ok) {
      setError(r.error.message)
      return onChanged(`${info.label} needs attention: ${r.error.message}`, 'error')
    }
    const mail = r.data.testEmail
    onChanged(
      mail
        ? mail.sent
          ? `${info.label} works. A test email was sent to ${mail.to}.`
          : `${info.label} is connected, but the test email failed: ${mail.error}`
        : `${info.label} works.`,
      mail && !mail.sent ? 'error' : 'success',
    )
  }

  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={titleId} className="text-title-sm font-semibold text-on-surface">
            {info.label}
          </h3>
          <p className="text-label-md text-on-surface-variant">{CHANNEL_LABEL[info.channel]}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={status.tone}>{status.label}</Badge>
          {connection?.isDefault && connection.status === 'connected' && (
            <Badge tone="info">Default for {CHANNEL_LABEL[info.channel]}</Badge>
          )}
        </div>
      </div>

      {info.connect === 'unavailable' && (
        <p className="text-body-md text-on-surface-variant">{info.unavailableReason}</p>
      )}
      {connection?.accountLabel && (
        <p className="text-body-md text-on-surface">
          Account: <span className="font-medium">{connection.accountLabel}</span>
        </p>
      )}
      {connection?.status === 'error' && connection.lastError && (
        <p className="text-body-md text-error">{connection.lastError}</p>
      )}
      {connection?.status === 'connected' && connection.capabilities.length > 0 && (
        <ul aria-label="What it can do" className="flex flex-wrap gap-1">
          {connection.capabilities.map((c) => (
            <li key={c}>
              <Badge>{CAPABILITY_LABEL[c]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {!connection &&
        info.connect !== 'unavailable' &&
        !readiness.ready &&
        readiness.missing.length > 0 && (
          <p className="text-label-md text-on-surface-variant">
            Needs these server settings in Vercel first:{' '}
            <span className="font-mono">{readiness.missing.join(', ')}</span>
          </p>
        )}
      {connection?.webhook && (
        <div className="rounded-md bg-surface-container-low p-3 text-label-md text-on-surface">
          <p className="font-semibold">
            For delivery reports, set this webhook address with {info.label}:
          </p>
          <p className="break-all font-mono">{connection.webhook.url}</p>
          {connection.webhook.verifyToken && (
            <p className="mt-1">
              Verify token:{' '}
              <span className="break-all font-mono">{connection.webhook.verifyToken}</span>
            </p>
          )}
        </div>
      )}
      {info.requirements.length > 0 && (
        <details className="text-body-md text-on-surface-variant">
          <summary className="cursor-pointer text-label-md font-semibold text-secondary">
            What you need
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {info.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {error && <FormError>{error}</FormError>}

      {info.connect !== 'unavailable' && (
        <div className="mt-auto flex flex-wrap gap-2">
          {!connection && (
            <Button
              onClick={() => void connect()}
              loading={busy === 'connect'}
              disabled={!readiness.ready}
            >
              Connect
            </Button>
          )}
          {connection && (
            <>
              <Button
                variant="secondary"
                onClick={() => void test(false)}
                loading={busy === 'test'}
                disabled={busy !== null}
              >
                Test
              </Button>
              {info.channel === 'email' && connection.status === 'connected' && (
                <Button
                  variant="secondary"
                  onClick={() => void test(true)}
                  loading={busy === 'testmail'}
                  disabled={busy !== null}
                >
                  Send Test Email
                </Button>
              )}
              {(info.settings?.length || ['facebook', 'instagram'].includes(info.key)) && (
                <Button
                  variant="secondary"
                  onClick={() => setDialog('settings')}
                  disabled={busy !== null}
                >
                  Settings
                </Button>
              )}
              {connection.status === 'connected' &&
                !connection.isDefault &&
                othersOnChannel > 0 && (
                  <Button
                    variant="secondary"
                    loading={busy === 'default'}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        'default',
                        () => setDefaultIntegration(connection.id),
                        `${info.label} is now the default for ${CHANNEL_LABEL[info.channel]}.`,
                      )
                    }
                  >
                    Make Default
                  </Button>
                )}
              {connection.status === 'error' && (
                <Button
                  onClick={() => void connect()}
                  loading={busy === 'connect'}
                  disabled={busy !== null || !readiness.ready}
                >
                  Reconnect
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setDialog('disconnect')}
                disabled={busy !== null}
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
      )}

      {dialog === 'connect' && (
        <ConnectDialog
          info={info}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null)
            onChanged(text)
          }}
        />
      )}
      {dialog === 'settings' && connection && (
        <SettingsDialog
          info={info}
          connection={connection}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null)
            onChanged(text)
          }}
        />
      )}
      {dialog === 'disconnect' && connection && (
        <Modal open title={`Disconnect ${info.label}?`} onClose={() => setDialog(null)}>
          <p className="text-body-md text-on-surface">
            Its saved keys or sign-in are deleted, and Umbane stops sending through it. Messages
            already sent stay in the history. You can connect it again later.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep It
            </Button>
            <Button
              loading={busy === 'disconnect'}
              onClick={() =>
                void run(
                  'disconnect',
                  () => disconnectIntegration(connection.id),
                  `${info.label} is disconnected.`,
                ).then(() => setDialog(null))
              }
            >
              Disconnect
            </Button>
          </div>
        </Modal>
      )}
    </li>
  )
}

function FieldInput({
  field,
  value,
  error,
  onChange,
  idPrefix,
}: {
  field: Field
  value: string
  error?: string
  onChange: (v: string) => void
  idPrefix: string
}) {
  const id = `${idPrefix}-${field.name}`
  if (field.options) {
    return (
      <Select
        id={id}
        label={field.label}
        hint={field.hint}
        error={error}
        options={[{ value: '', label: 'Choose…' }, ...field.options]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Input
      id={id}
      label={field.required ? field.label : `${field.label} (optional)`}
      type={field.secret ? 'password' : 'text'}
      autoComplete="off"
      spellCheck={false}
      placeholder={field.placeholder}
      hint={field.hint}
      error={error}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function ConnectDialog({
  info,
  onClose,
  onDone,
}: {
  info: ProviderInfo
  onClose: () => void
  onDone: (text: string) => void
}) {
  const fields = [...(info.fields ?? []), ...(info.settings ?? [])]
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    for (const f of fields) {
      const p = fieldProblem(f, values[f.name])
      if (p) found[f.name] = p
    }
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setError(null)
    const pick = (list: Field[] = []) =>
      Object.fromEntries(
        list.map((f) => [f.name, (values[f.name] ?? '').trim()]).filter(([, v]) => v),
      )
    const r = await connectWithKeys(info.key, pick(info.fields), pick(info.settings))
    setBusy(false)
    if (r.ok)
      return onDone(
        `${info.label} is connected as ${r.data.connection.accountLabel ?? info.label}.`,
      )
    setError(r.error.message)
    if (r.fields) setErrors(r.fields)
  }

  return (
    <Modal open title={`Connect ${info.label}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <p className="text-body-md text-on-surface-variant">
          Umbane checks these with {info.label} before saving. Keys are stored encrypted on the
          server and are never shown again.
        </p>
        {error && <FormError>{error}</FormError>}
        {fields.map((f) => (
          <FieldInput
            key={f.name}
            idPrefix={`connect-${info.key}`}
            field={f}
            value={values[f.name] ?? ''}
            error={errors[f.name]}
            onChange={(v) => setValues((x) => ({ ...x, [f.name]: v }))}
          />
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Check and Connect
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function SettingsDialog({
  info,
  connection,
  onClose,
  onDone,
}: {
  info: ProviderInfo
  connection: IntegrationConnection
  onClose: () => void
  onDone: (text: string) => void
}) {
  const choices: {
    name: 'pageId' | 'igUserId'
    label: string
    options: { id: string; name: string }[]
  } | null = (() => {
    const raw =
      info.key === 'facebook'
        ? connection.settings.pageOptions
        : info.key === 'instagram'
          ? connection.settings.accountOptions
          : undefined
    if (!raw) return null
    try {
      const options = JSON.parse(raw) as { id: string; name: string }[]
      return {
        name: info.key === 'facebook' ? 'pageId' : 'igUserId',
        label: info.key === 'facebook' ? 'Facebook Page' : 'Instagram account',
        options,
      }
    } catch {
      return null
    }
  })()
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...connection.settings }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    for (const f of info.settings ?? []) {
      const p = fieldProblem(f, values[f.name])
      if (p) found[f.name] = p
    }
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setError(null)
    const out: Record<string, string> = {}
    for (const f of info.settings ?? [])
      if ((values[f.name] ?? '').trim()) out[f.name] = values[f.name].trim()
    if (choices && values[choices.name]) out[choices.name] = values[choices.name]
    const r = await updateIntegrationSettings(connection.id, out)
    setBusy(false)
    if (r.ok) return onDone(`${info.label} settings saved.`)
    setError(r.error.message)
    if (r.fields) setErrors(r.fields)
  }

  return (
    <Modal open title={`${info.label} settings`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        {choices && (
          <Select
            id={`settings-${info.key}-${choices.name}`}
            label={choices.label}
            options={choices.options.map((o) => ({ value: o.id, label: o.name }))}
            value={values[choices.name] ?? ''}
            onChange={(e) => setValues((x) => ({ ...x, [choices.name]: e.target.value }))}
          />
        )}
        {(info.settings ?? []).map((f) => (
          <FieldInput
            key={f.name}
            idPrefix={`settings-${info.key}`}
            field={f}
            value={values[f.name] ?? ''}
            error={errors[f.name]}
            onChange={(v) => setValues((x) => ({ ...x, [f.name]: v }))}
          />
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save and Check
          </Button>
        </div>
      </form>
    </Modal>
  )
}
