import { useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/useAuth'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getBusinessName,
  getCustomerPreferences,
  listTemplates,
  queueEmail,
  sendNow,
  uploadEmailAttachment,
} from '@/services/messages'
import type { Result } from '@/types/api'
import type { CustomerPreferences, MessageTemplate } from '@/types/messages'
import { ok } from '@/utils/result'
import { renderTemplate, validateEmail, whyNotEmail, type EmailFormErrors } from '@/utils/templates'

/** Put where {{message}} goes; the email cannot be sent until it is replaced. */
export const MESSAGE_PROMPT = '[Write your message here]'

export interface ComposeProps {
  customerId: string
  customerName: string
  /** Values for the placeholders this context knows (invoice number, ticket reference, ...). */
  values?: Record<string, string | null | undefined>
  templateKey?: string
  invoiceId?: string | null
  ticketId?: string | null
  /** Makes the PDF to attach, when there is one (invoices). */
  attachment?: { label: string; build: () => Promise<Result<{ bytes: Uint8Array; name: string }>> }
  onClose: () => void
  onDone: (notice: string) => void
}

interface Loaded {
  templates: MessageTemplate[]
  prefs: CustomerPreferences
  businessName: string
}

async function load(customerId: string): Promise<Result<Loaded>> {
  const [templates, prefs, business] = await Promise.all([
    listTemplates(),
    getCustomerPreferences(customerId),
    getBusinessName(),
  ])
  if (!templates.ok) return templates
  if (!prefs.ok) return prefs
  return ok({
    templates: templates.data.filter((t) => t.isActive),
    prefs: prefs.data,
    businessName: business.ok ? business.data : '',
  })
}

/** Writes an email from a template, checks the customer may receive it, then queues and sends it. */
export function ComposeEmailDialog(props: ComposeProps) {
  const state = useResource(() => load(props.customerId), `compose-${props.customerId}`)
  return (
    <Modal open title={`Email ${props.customerName}`} onClose={props.onClose}>
      <ResourceBoundary state={state} skeletonLines={5}>
        {(data) => <ComposeForm {...props} data={data} />}
      </ResourceBoundary>
    </Modal>
  )
}

function ComposeForm({
  customerId,
  customerName,
  values = {},
  templateKey,
  invoiceId,
  ticketId,
  attachment,
  onClose,
  onDone,
  data,
}: ComposeProps & { data: Loaded }) {
  const { profile } = useAuth()
  const fill = (t: MessageTemplate | undefined) => {
    const all = {
      customer_name: customerName,
      business_name: data.businessName,
      sender_name: profile?.full_name ?? '',
      message: MESSAGE_PROMPT,
      ...values,
    }
    return {
      subject: t ? renderTemplate(t.subject, all).text : '',
      body: t ? renderTemplate(t.body, all).text : '',
    }
  }
  const initial =
    data.templates.find((t) => t.key === templateKey) ??
    data.templates.find((t) => t.key === 'general') ??
    data.templates[0]
  const [chosen, setChosen] = useState(initial?.key ?? '')
  const [subject, setSubject] = useState(() => fill(initial).subject)
  const [body, setBody] = useState(() => fill(initial).body)
  const [attach, setAttach] = useState(Boolean(attachment))
  const [errors, setErrors] = useState<EmailFormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const template = data.templates.find((t) => t.key === chosen)
  const purpose = template?.purpose ?? 'transactional'
  const blocked = whyNotEmail(data.prefs, purpose)

  function choose(key: string) {
    const t = data.templates.find((x) => x.key === key)
    setChosen(key)
    const filled = fill(t)
    setSubject(filled.subject)
    setBody(filled.body)
    setErrors({})
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const found = validateEmail(subject, body)
    if (body.includes(MESSAGE_PROMPT))
      found.body = 'Replace “[Write your message here]” with your message.'
    setErrors(found)
    if (Object.keys(found).length > 0 || blocked) return
    setBusy(true)
    let file: { path: string; name: string } | null = null
    if (attachment && attach) {
      const built = await attachment.build()
      const uploaded = built.ok
        ? await uploadEmailAttachment(profile?.business_id ?? '', built.data.bytes, built.data.name)
        : built
      if (!uploaded.ok) {
        setBusy(false)
        return setError(uploaded.error.message)
      }
      file = uploaded.data
    }
    const queued = await queueEmail({
      customerId,
      subject: subject.trim(),
      body: body.trim(),
      templateKey: template?.key ?? null,
      purpose,
      invoiceId: invoiceId ?? null,
      ticketId: ticketId ?? null,
      attachment: file,
    })
    if (!queued.ok) {
      setBusy(false)
      return setError(queued.error.message)
    }
    const sent = await sendNow(queued.data.id)
    setBusy(false)
    onDone(
      sent.state === 'sent'
        ? `Email sent to ${data.prefs.email}.`
        : sent.state === 'failed'
          ? `The email could not be sent yet${sent.error ? ` (${sent.error})` : ''}. It will be tried again automatically.`
          : sent.reason === 'not_configured'
            ? 'Email saved. It will be sent once email is set up: see Communications.'
            : 'Email saved and waiting to be sent. Check Communications for its progress.',
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error && <FormError>{error}</FormError>}
      <p className="text-body-md text-on-surface-variant">
        To:{' '}
        <span className="font-medium text-on-surface">
          {data.prefs.email ?? 'no email address'}
        </span>
      </p>
      {blocked && <FormError>{blocked}</FormError>}
      <Select
        id="compose-template"
        label="Template"
        options={data.templates.map((t) => ({ value: t.key, label: t.name }))}
        value={chosen}
        onChange={(e) => choose(e.target.value)}
      />
      <Input
        id="compose-subject"
        label="Subject"
        value={subject}
        error={errors.subject}
        onChange={(e) => {
          setSubject(e.target.value)
          setErrors((x) => ({ ...x, subject: undefined }))
        }}
      />
      <Textarea
        id="compose-body"
        label="Message"
        rows={10}
        value={body}
        error={errors.body}
        onChange={(e) => {
          setBody(e.target.value)
          setErrors((x) => ({ ...x, body: undefined }))
        }}
      />
      {attachment && (
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={attach}
            onChange={(e) => setAttach(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Attach {attachment.label}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={Boolean(blocked)}>
          Send Email
        </Button>
      </div>
    </form>
  )
}
