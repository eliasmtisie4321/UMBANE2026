import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  CHANNEL_LABEL,
  DIRECT_CHANNELS,
  SOCIAL_CHANNELS,
  providerInfo,
  type Channel,
} from '@shared/integrations'
import { useAuth } from '@/auth/useAuth'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Badge, Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getBusinessName,
  listTemplates,
  retryMessage,
  uploadEmailAttachment,
} from '@/services/messages'
import {
  getMessageStates,
  getReachability,
  listDestinations,
  listTeamRecipients,
  newShareId,
  queueMessage,
  reachabilityOf,
  sendMessages,
  type TeamRecipient,
} from '@/services/share'
import type { Result } from '@/types/api'
import type {
  DeliveryState,
  IntegrationConnection,
  Reachability,
  Recipient,
  ShareResult,
} from '@/types/integrations'
import type { MessageTemplate } from '@/types/messages'
import { ok } from '@/utils/result'
import { renderTemplate } from '@/utils/templates'

/** Put where {{message}} goes; nothing is sent until it is replaced. */
export const MESSAGE_PROMPT = '[Write your message here]'

/** What is being shared, and with whom it may go. */
export interface ShareContext {
  /** The dialog's title, e.g. "Share invoice INV-2026-00001". */
  title: string
  /** The person it is about: offered as the recipient, at the address or number on file. */
  customer?: { id: string; name: string } | null
  lead?: { id: string; name: string } | null
  /** Team members can receive it (reports, documents for colleagues). */
  allowTeam?: boolean
  /** Managers may also type an address or number (an accountant, a supplier). */
  allowAddress?: boolean
  templateKey?: string
  /** Values for the template placeholders this context knows. */
  values?: Record<string, string | null | undefined>
  subject?: string
  body?: string
  invoiceId?: string | null
  ticketId?: string | null
  orderId?: string | null
  reportKey?: string | null
  /** Makes the PDF to attach, when there is one. */
  attachment?: { label: string; build: () => Promise<Result<{ bytes: Uint8Array; name: string }>> }
}

export interface ShareDialogProps {
  context: ShareContext
  /** direct: messages to people. social: a public post. */
  mode?: 'direct' | 'social'
  onClose: () => void
  onDone: (notice: string) => void
}

const LIMITS: Partial<Record<Channel, number>> = {
  sms: 1500,
  whatsapp: 4000,
  instagram: 2200,
  linkedin: 3000,
  facebook: 10000,
  email: 10000,
}
const HTTPS = /^https:\/\/\S{4,}$/

/** A platform in the list: ready to use, or why not. */
interface Platform {
  channel: Channel
  connection: IntegrationConnection | null
  ready: boolean
  /** Shown under the name: the account it goes from, or what is missing. */
  note: string
}

interface Loaded {
  platforms: Platform[]
  templates: MessageTemplate[]
  businessName: string
  team: TeamRecipient[]
  reach: Record<string, Reachability>
}

const recipientKey = (r: Recipient) =>
  r.kind === 'address' ? `address:${r.value.trim().toLowerCase()}` : `${r.kind}:${r.id}`
const recipientLabel = (r: Recipient) => (r.kind === 'address' ? r.value.trim() : r.name)

function platformsFrom(
  connections: IntegrationConnection[],
  builtInEmail: boolean,
  mode: 'direct' | 'social',
): Platform[] {
  return (mode === 'social' ? SOCIAL_CHANNELS : DIRECT_CHANNELS).map((channel) => {
    if (channel === 'tiktok') {
      return {
        channel,
        connection: null,
        ready: false,
        note: 'Not available: TikTok only accepts video and photo posts from approved apps.',
      }
    }
    const live = connections.filter((c) => c.channel === channel)
    const connection =
      live.find((c) => c.status === 'connected' && c.isDefault) ??
      live.find((c) => c.status === 'connected') ??
      null
    if (connection) {
      const label = providerInfo(connection.provider)?.label ?? connection.provider
      return {
        channel,
        connection,
        ready: true,
        note: `${label}${connection.accountLabel ? ` · ${connection.accountLabel}` : ''}`,
      }
    }
    if (channel === 'email' && builtInEmail)
      return { channel, connection: null, ready: true, note: 'Built-in email' }
    if (live.some((c) => c.status === 'error'))
      return { channel, connection: null, ready: false, note: 'Needs attention' }
    return { channel, connection: null, ready: false, note: 'Not connected' }
  })
}

async function load(context: ShareContext, mode: 'direct' | 'social'): Promise<Result<Loaded>> {
  const recipients: Recipient[] = [
    ...(context.customer ? [{ kind: 'customer' as const, ...context.customer }] : []),
    ...(context.lead ? [{ kind: 'lead' as const, ...context.lead }] : []),
  ]
  const [destinations, templates, business, team, ...reach] = await Promise.all([
    listDestinations(),
    mode === 'direct' ? listTemplates() : Promise.resolve(ok([] as MessageTemplate[])),
    getBusinessName(),
    mode === 'direct' && context.allowTeam
      ? listTeamRecipients()
      : Promise.resolve(ok([] as TeamRecipient[])),
    ...recipients.map((r) => getReachability(r)),
  ])
  if (!destinations.ok) return destinations
  if (!templates.ok) return templates
  const reachMap: Record<string, Reachability> = {}
  recipients.forEach((r, i) => {
    const got = reach[i]
    if (got.ok) reachMap[recipientKey(r)] = got.data
  })
  const members = team.ok ? team.data : []
  for (const m of members)
    reachMap[`member:${m.id}`] = reachabilityOf({ email: m.email, phone: m.phone })
  return ok({
    platforms: platformsFrom(destinations.data.connections, destinations.data.builtInEmail, mode),
    templates: templates.data.filter((t) => t.isActive),
    businessName: business.ok ? business.data : '',
    team: members,
    reach: reachMap,
  })
}

/**
 * Share or send something to one or more platforms at once: email, SMS and WhatsApp to people on
 * file, or a public post to the business's social pages (mode "social"). It only offers what each
 * connected provider really supports, shows a preview for each platform, and then the result of
 * each delivery, with retry for failures.
 */
export function ShareDialog({ context, mode = 'direct', onClose, onDone }: ShareDialogProps) {
  const state = useResource(() => load(context, mode), `share-${mode}-${context.title}`)
  return (
    <Modal open title={context.title} onClose={onClose}>
      <ResourceBoundary state={state} skeletonLines={6}>
        {(data) => (
          <ShareForm context={context} mode={mode} data={data} onClose={onClose} onDone={onDone} />
        )}
      </ResourceBoundary>
    </Modal>
  )
}

function ShareForm({
  context,
  mode,
  data,
  onClose,
  onDone,
}: ShareDialogProps & { mode: 'direct' | 'social'; data: Loaded }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'administrator'
  const isManager = profile?.role === 'administrator' || profile?.role === 'manager'
  const social = mode === 'social'
  const [shareId] = useState(newShareId)

  const fill = (t: MessageTemplate | undefined) => {
    const values = {
      customer_name: context.customer?.name ?? context.lead?.name ?? '',
      business_name: data.businessName,
      sender_name: profile?.full_name ?? '',
      message: MESSAGE_PROMPT,
      ...(context.values ?? {}),
    }
    return {
      subject: t ? renderTemplate(t.subject, values).text : (context.subject ?? ''),
      body: t ? renderTemplate(t.body, values).text : (context.body ?? ''),
    }
  }
  const initialTemplate =
    data.templates.find((t) => t.key === context.templateKey) ??
    (context.body ? undefined : data.templates.find((t) => t.key === 'general'))
  const [templateKey, setTemplateKey] = useState(initialTemplate?.key ?? '')
  const [subject, setSubject] = useState(() => fill(initialTemplate).subject)
  const [body, setBody] = useState(() => fill(initialTemplate).body)
  const [attach, setAttach] = useState(Boolean(context.attachment))
  const [linkUrl, setLinkUrl] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [channels, setChannels] = useState<Channel[]>(() => {
    const first = data.platforms.find((p) => p.ready)
    return first ? [first.channel] : []
  })
  const defaultRecipients: Recipient[] = context.customer
    ? [{ kind: 'customer', ...context.customer }]
    : context.lead
      ? [{ kind: 'lead', ...context.lead }]
      : []
  const [recipients, setRecipients] = useState<Recipient[]>(defaultRecipients)
  const [address, setAddress] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ShareResult[] | null>(null)

  const template = data.templates.find((t) => t.key === templateKey)
  const purpose = social ? 'marketing' : (template?.purpose ?? 'transactional')
  const all: Recipient[] = useMemo(
    () => [
      ...recipients,
      ...(address.trim() ? [{ kind: 'address' as const, value: address.trim() }] : []),
    ],
    [recipients, address],
  )
  const reachOf = (r: Recipient): Reachability =>
    r.kind === 'address'
      ? reachabilityOf({
          email: r.value.includes('@') ? r.value : null,
          phone: r.value.includes('@') ? null : r.value,
        })
      : (data.reach[recipientKey(r)] ?? reachabilityOf({ email: null, phone: null }))

  /** Why this recipient cannot get it on this platform, if they cannot. */
  function blockedFor(r: Recipient, channel: Channel): string | null {
    if (social) return null
    const reach = reachOf(r)
    const why = reach.blocked[channel as 'email' | 'sms' | 'whatsapp']
    if (why) return why
    if (purpose === 'marketing' && (r.kind !== 'customer' || !reach.marketingConsent))
      return 'No marketing consent'
    return null
  }

  const toggle = <T,>(list: T[], item: T, same: (a: T, b: T) => boolean) =>
    list.some((x) => same(x, item)) ? list.filter((x) => !same(x, item)) : [...list, item]

  function chooseTemplate(key: string) {
    setTemplateKey(key)
    const filled = fill(data.templates.find((t) => t.key === key))
    setSubject(filled.subject)
    setBody(filled.body)
  }

  const limit = Math.min(...channels.map((c) => LIMITS[c] ?? 10000), 10000)
  const fileName = context.attachment ? context.attachment.label : null

  function validate() {
    const found: Record<string, string> = {}
    if (!channels.length)
      found.platforms = social ? 'Choose where to publish.' : 'Choose at least one platform.'
    if (!social && !all.length) found.recipients = 'Choose who should receive it.'
    if (!body.trim()) found.body = 'Write a message.'
    else if (body.includes(MESSAGE_PROMPT))
      found.body = 'Replace “[Write your message here]” with your message.'
    else if (body.trim().length > limit)
      found.body = `Too long for the platforms chosen: at most ${limit} characters.`
    if (channels.includes('email') && !subject.trim()) found.subject = 'An email needs a subject.'
    if (linkUrl && !HTTPS.test(linkUrl)) found.linkUrl = 'Use a full https:// address.'
    if (imageUrl && !HTTPS.test(imageUrl)) found.imageUrl = 'Use a full https:// address.'
    if (channels.includes('instagram') && !imageUrl)
      found.imageUrl = 'Instagram posts need an image address.'
    if (address.trim() && !/@/.test(address) && !/^[+0-9][0-9 ()-]{8,}$/.test(address.trim())) {
      found.address = 'Enter an email address or a mobile number.'
    }
    return found
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    let file: { path: string; name: string } | null = null
    if (context.attachment && attach && !social) {
      const built = await context.attachment.build()
      const uploaded = built.ok
        ? await uploadEmailAttachment(profile?.business_id ?? '', built.data.bytes, built.data.name)
        : built
      if (!uploaded.ok) {
        setBusy(false)
        return setError(uploaded.error.message)
      }
      file = uploaded.data
    }
    const out: ShareResult[] = []
    const targets: (Recipient | null)[] = social ? [null] : all
    for (const channel of channels) {
      const platform = data.platforms.find((p) => p.channel === channel)!
      for (const r of targets) {
        const key = `${shareId}:${channel}:${r ? recipientKey(r) : 'post'}`
        const label = r
          ? recipientLabel(r)
          : (platform.connection?.accountLabel ?? CHANNEL_LABEL[channel])
        const why = r ? blockedFor(r, channel) : null
        if (why) {
          out.push({
            key,
            channel,
            recipientLabel: label,
            messageId: null,
            state: 'refused',
            error: why,
          })
          continue
        }
        const queued = await queueMessage({
          channel,
          integrationId: platform.connection?.id ?? null,
          recipient: r,
          subject: channel === 'email' ? subject.trim() : null,
          body: body.trim(),
          purpose,
          templateKey: template?.key ?? null,
          invoiceId: social ? null : (context.invoiceId ?? null),
          ticketId: social ? null : (context.ticketId ?? null),
          orderId: social ? null : (context.orderId ?? null),
          reportKey: social ? null : (context.reportKey ?? null),
          attachment: file,
          linkUrl: linkUrl || null,
          imageUrl: social && imageUrl ? imageUrl : null,
          shareId,
          idempotencyKey: key.slice(0, 120),
        })
        out.push(
          queued.ok
            ? {
                key,
                channel,
                recipientLabel: label,
                messageId: queued.data.id,
                state: 'queued',
                error: null,
              }
            : {
                key,
                channel,
                recipientLabel: label,
                messageId: null,
                state: 'refused',
                error: queued.error.message,
              },
        )
      }
    }
    const ids = out.flatMap((r) => (r.messageId ? [r.messageId] : []))
    await sendMessages(ids)
    setResults(await withStates(out))
    setBusy(false)
  }

  async function withStates(list: ShareResult[]): Promise<ShareResult[]> {
    const states = await getMessageStates(list.flatMap((r) => (r.messageId ? [r.messageId] : [])))
    if (!states.ok) return list
    return list.map((r) => {
      const s = r.messageId ? states.data[r.messageId] : undefined
      return s ? { ...r, state: s.state, error: s.error } : r
    })
  }

  async function retry(r: ShareResult) {
    if (!r.messageId) return
    const again = await retryMessage(r.messageId)
    if (!again.ok) {
      setResults(
        (list) =>
          list?.map((x) => (x.key === r.key ? { ...x, error: again.error.message } : x)) ?? null,
      )
      return
    }
    await sendMessages([r.messageId])
    const updated = await withStates([r])
    setResults((list) => list?.map((x) => (x.key === r.key ? updated[0] : x)) ?? null)
  }

  if (results) {
    const done = results.filter((r) => ['sent', 'delivered'].includes(r.state)).length
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-on-surface" role="status">
          {done === results.length
            ? social
              ? 'Published.'
              : 'Sent.'
            : `${done} of ${results.length} ${social ? 'published' : 'sent'}. The others are below.`}
        </p>
        <ul
          aria-label="Delivery"
          className="flex flex-col divide-y divide-outline-variant rounded-lg border border-outline-variant"
        >
          {results.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="font-medium text-on-surface">
                  {CHANNEL_LABEL[r.channel]} · {r.recipientLabel}
                </p>
                {r.error && <p className="text-label-sm text-error">{r.error}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StateBadge state={r.state} />
                {r.state === 'failed' && r.messageId && (
                  <Button variant="secondary" onClick={() => void retry(r)}>
                    Try Again
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-label-sm text-on-surface-variant">
          Every message is in Communications with its delivery reports.
        </p>
        <div className="flex justify-end">
          <Button
            onClick={() =>
              onDone(
                done === results.length
                  ? `${social ? 'Published' : 'Sent'} to ${results.length === 1 ? CHANNEL_LABEL[results[0].channel] : `${results.length} destinations`}.`
                  : `${done} of ${results.length} ${social ? 'published' : 'sent'}; see Communications for the rest.`,
              )
            }
          >
            Done
          </Button>
        </div>
      </div>
    )
  }

  const connectHint = isAdmin ? (
    <Link to="/settings/integrations" className="text-primary underline">
      Connect in Settings → Integrations
    </Link>
  ) : (
    <span>Ask an administrator to connect it</span>
  )

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && <FormError>{error}</FormError>}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label-md font-semibold text-on-surface">
          {social ? 'Publish to' : 'Send by'}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.platforms.map((p) => (
            <label
              key={p.channel}
              className={`flex items-start gap-2 rounded-lg border p-3 ${p.ready ? 'border-outline-variant' : 'border-dashed border-outline-variant opacity-80'}`}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                aria-label={CHANNEL_LABEL[p.channel]}
                aria-describedby={`share-platform-${p.channel}`}
                checked={channels.includes(p.channel)}
                disabled={!p.ready}
                onChange={() => setChannels((list) => toggle(list, p.channel, (a, b) => a === b))}
              />
              <span className="min-w-0">
                <span className="block font-medium text-on-surface">
                  {CHANNEL_LABEL[p.channel]}
                </span>
                <span
                  id={`share-platform-${p.channel}`}
                  className="block text-label-sm text-on-surface-variant"
                >
                  {p.note}
                </span>
                {!p.ready && p.channel !== 'tiktok' && (
                  <span className="block text-label-sm">{connectHint}</span>
                )}
              </span>
            </label>
          ))}
        </div>
        {errors.platforms && (
          <p role="alert" className="text-label-sm text-error">
            {errors.platforms}
          </p>
        )}
      </fieldset>

      {!social && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label-md font-semibold text-on-surface">To</legend>
          {defaultRecipients.map((r) => (
            <RecipientRow
              key={recipientKey(r)}
              recipient={r}
              checked={recipients.some((x) => recipientKey(x) === recipientKey(r))}
              onToggle={() =>
                setRecipients((list) =>
                  toggle(list, r, (a, b) => recipientKey(a) === recipientKey(b)),
                )
              }
              reach={reachOf(r)}
              channels={channels}
              blockedFor={blockedFor}
            />
          ))}
          {data.team.map((m) => {
            const r: Recipient = { kind: 'member', id: m.id, name: m.name }
            return (
              <RecipientRow
                key={m.id}
                recipient={r}
                checked={recipients.some((x) => recipientKey(x) === recipientKey(r))}
                onToggle={() =>
                  setRecipients((list) =>
                    toggle(list, r, (a, b) => recipientKey(a) === recipientKey(b)),
                  )
                }
                reach={reachOf(r)}
                channels={channels}
                blockedFor={blockedFor}
              />
            )
          })}
          {context.allowAddress && isManager && (
            <Input
              id="share-address"
              label="Someone else (email address or mobile number)"
              hint="For service messages only, such as a report to your accountant."
              value={address}
              error={errors.address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
          {errors.recipients && (
            <p role="alert" className="text-label-sm text-error">
              {errors.recipients}
            </p>
          )}
        </fieldset>
      )}

      {!social && data.templates.length > 0 && (
        <Select
          id="share-template"
          label="Template"
          options={[
            { value: '', label: 'No template' },
            ...data.templates.map((t) => ({ value: t.key, label: t.name })),
          ]}
          value={templateKey}
          onChange={(e) => chooseTemplate(e.target.value)}
        />
      )}
      {channels.includes('email') && (
        <Input
          id="share-subject"
          label="Email subject"
          value={subject}
          error={errors.subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      )}
      <Textarea
        id="share-body"
        label={social ? 'Post' : 'Message'}
        rows={social ? 6 : 9}
        value={body}
        error={errors.body}
        hint={`${body.trim().length} of ${limit} characters`}
        onChange={(e) => setBody(e.target.value)}
      />
      {social && (
        <>
          <Input
            id="share-link"
            label="Link (optional)"
            placeholder="https://"
            value={linkUrl}
            error={errors.linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <Input
            id="share-image"
            label={channels.includes('instagram') ? 'Image address' : 'Image address (optional)'}
            placeholder="https://"
            hint="A picture at a public https address. Instagram needs one."
            value={imageUrl}
            error={errors.imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
        </>
      )}
      {context.attachment && !social && (
        <label className="flex items-start gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={attach}
            onChange={(e) => setAttach(e.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            Attach {context.attachment.label}
            {channels.includes('sms') && (
              <span className="block text-label-sm text-on-surface-variant">
                SMS cannot carry files: it gets a private link that works for 30 days.
              </span>
            )}
          </span>
        </label>
      )}
      {purpose === 'marketing' && !social && (
        <p className="rounded-lg bg-tertiary-container p-3 text-label-md text-on-tertiary-container">
          Marketing: only customers who agreed to receive marketing get it. Say how to opt out.
        </p>
      )}

      {channels.length > 0 && body.trim() && (
        <section aria-label="Preview" className="flex flex-col gap-2">
          <h3 className="text-label-md font-semibold text-on-surface">Preview</h3>
          {channels.map((c) => (
            <Preview
              key={c}
              channel={c}
              platform={data.platforms.find((p) => p.channel === c)!}
              to={all[0] ? recipientLabel(all[0]) : null}
              subject={subject}
              body={body.trim()}
              file={attach && !social ? fileName : null}
              linkUrl={linkUrl}
              imageUrl={imageUrl}
            />
          ))}
        </section>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!data.platforms.some((p) => p.ready)}>
          {social ? 'Publish' : 'Send'}
        </Button>
      </div>
    </form>
  )
}

function RecipientRow({
  recipient,
  checked,
  onToggle,
  reach,
  channels,
  blockedFor,
}: {
  recipient: Recipient
  checked: boolean
  onToggle: () => void
  reach: Reachability
  channels: Channel[]
  blockedFor: (r: Recipient, c: Channel) => string | null
}) {
  const problems = channels
    .map((c) => [c, blockedFor(recipient, c)] as const)
    .filter(([, why]) => why)
  const on = [reach.email, reach.phone].filter(Boolean).join(' · ')
  return (
    <label className="flex items-start gap-2 rounded-lg border border-outline-variant p-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-primary"
        aria-label={recipientLabel(recipient)}
        checked={checked}
        onChange={onToggle}
      />
      <span className="min-w-0">
        <span className="block font-medium text-on-surface">{recipientLabel(recipient)}</span>
        <span className="block text-label-sm text-on-surface-variant">
          {on || 'Nothing on file'}
        </span>
        {problems.map(([c, why]) => (
          <span key={c} className="block text-label-sm text-error">
            {CHANNEL_LABEL[c]}: {why}
          </span>
        ))}
      </span>
    </label>
  )
}

function Preview({
  channel,
  platform,
  to,
  subject,
  body,
  file,
  linkUrl,
  imageUrl,
}: {
  channel: Channel
  platform: Platform
  to: string | null
  subject: string
  body: string
  file: string | null
  linkUrl: string
  imageUrl: string
}) {
  const from = platform.connection?.accountLabel ?? platform.note
  const template = channel === 'whatsapp' ? platform.connection?.settings.templateName : undefined
  const segments =
    channel === 'sms' ? Math.max(1, Math.ceil((body.length + (file ? 80 : 0)) / 153)) : 0
  return (
    <article
      aria-label={`${CHANNEL_LABEL[channel]} preview`}
      className="rounded-lg border border-outline-variant bg-surface-container-low p-3 text-body-md"
    >
      <p className="mb-1 text-label-sm text-on-surface-variant">
        {CHANNEL_LABEL[channel]} · from {from}
        {to && channel !== 'facebook' && channel !== 'instagram' && channel !== 'linkedin'
          ? ` · to ${to}`
          : ''}
      </p>
      {channel === 'email' && <p className="font-semibold text-on-surface">{subject}</p>}
      {imageUrl && ['facebook', 'instagram'].includes(channel) && (
        <p className="text-label-sm text-on-surface-variant">Image: {imageUrl}</p>
      )}
      <p className="whitespace-pre-wrap text-on-surface">{body}</p>
      {linkUrl && ['facebook', 'instagram', 'linkedin'].includes(channel) && (
        <p className="text-primary">{linkUrl}</p>
      )}
      {file && (
        <p className="mt-1 text-label-sm text-on-surface-variant">
          {channel === 'sms' ? `Private link to ${file}` : `Attached: ${file}`}
        </p>
      )}
      {segments > 1 && (
        <p className="mt-1 text-label-sm text-on-surface-variant">
          About {segments} SMS messages long.
        </p>
      )}
      {template && (
        <p className="mt-1 text-label-sm text-on-surface-variant">
          Sent with your approved WhatsApp template “{template}”.
        </p>
      )}
    </article>
  )
}

function StateBadge({ state }: { state: DeliveryState }) {
  const map: Record<
    DeliveryState,
    { tone: 'neutral' | 'info' | 'success' | 'warning' | 'error'; label: string }
  > = {
    queued: { tone: 'neutral', label: 'Waiting' },
    sending: { tone: 'info', label: 'Sending' },
    sent: { tone: 'success', label: 'Sent' },
    delivered: { tone: 'success', label: 'Delivered' },
    failed: { tone: 'error', label: 'Failed' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
    refused: { tone: 'warning', label: 'Not sent' },
  }
  const s = map[state] ?? map.queued
  return <Badge tone={s.tone}>{s.label}</Badge>
}
