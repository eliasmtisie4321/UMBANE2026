import { Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Badge, Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { listTemplates, saveTemplate } from '@/services/messages'
import type { MessageTemplate, Purpose } from '@/types/messages'
import { formatDate } from '@/utils/format'
import {
  PLACEHOLDERS,
  renderTemplate,
  validateTemplate,
  type TemplateFormErrors,
  type TemplateFormValues,
} from '@/utils/templates'

/** Sample values for the preview, so a manager sees what a customer will read. */
const SAMPLE: Record<string, string> = {
  customer_name: 'Naledi Dlamini',
  business_name: 'Umbane',
  sender_name: 'Elias Nkosi',
  message: 'Your meter was replaced this morning and is working normally.',
  invoice_number: 'INV-2026-00042',
  invoice_total: 'R 4,950.00',
  balance_due: 'R 4,950.00',
  due_date: '15 Dec 2026',
  ticket_reference: 'TKT-2026-00418',
  ticket_subject: 'Meter display is blank',
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: MessageTemplate | null
  onClose: () => void
  onSaved: (notice: string) => void
}) {
  const [v, setV] = useState<TemplateFormValues>(
    template
      ? {
          key: template.key,
          name: template.name,
          purpose: template.purpose,
          subject: template.subject,
          body: template.body,
          isActive: template.isActive,
        }
      : { key: '', name: '', purpose: 'transactional', subject: '', body: '', isActive: true },
  )
  const [errors, setErrors] = useState<TemplateFormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TemplateFormValues>(k: K, value: TemplateFormValues[K]) => {
    setV((x) => ({ ...x, [k]: value }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const found = validateTemplate(v, template === null)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    const result = await saveTemplate(template?.id ?? null, v)
    setBusy(false)
    if (!result.ok) {
      if (result.error.field === 'key') return setErrors({ key: result.error.message })
      return setError(result.error.message)
    }
    onSaved(template ? 'Template saved.' : 'Template added.')
  }

  return (
    <Modal open title={template ? `Edit ${template.name}` : 'New template'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <Input
          id="template-name"
          label="Name"
          value={v.name}
          error={errors.name}
          onChange={(e) => set('name', e.target.value)}
        />
        {template === null && (
          <Input
            id="template-key"
            label="Key"
            hint="A short code that never changes, e.g. winter_tips."
            value={v.key}
            error={errors.key}
            onChange={(e) => set('key', e.target.value.toLowerCase())}
          />
        )}
        <Select
          id="template-purpose"
          label="Kind"
          options={[
            { value: 'transactional', label: 'Service message (invoices, tickets, account)' },
            { value: 'marketing', label: 'Marketing (only to customers who agreed)' },
          ]}
          value={v.purpose}
          onChange={(e) => set('purpose', e.target.value as Purpose)}
        />
        <Input
          id="template-subject"
          label="Subject"
          value={v.subject}
          error={errors.subject}
          onChange={(e) => set('subject', e.target.value)}
        />
        <Textarea
          id="template-body"
          label="Message"
          rows={8}
          value={v.body}
          error={errors.body}
          onChange={(e) => set('body', e.target.value)}
        />
        <details className="text-label-md text-on-surface-variant">
          <summary className="cursor-pointer font-medium text-on-surface">Placeholders</summary>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {PLACEHOLDERS.map((p) => (
              <li key={p.key}>
                <code className="font-mono">{`{{${p.key}}}`}</code> {p.label}
              </li>
            ))}
          </ul>
        </details>
        <section
          aria-label="Preview"
          className="rounded-md border border-outline-variant bg-surface-container-low p-3"
        >
          <p className="text-label-md font-semibold text-on-surface">Preview</p>
          <p className="mt-1 text-body-md font-medium">{renderTemplate(v.subject, SAMPLE).text}</p>
          <p className="mt-1 whitespace-pre-wrap text-body-md">
            {renderTemplate(v.body, SAMPLE).text}
          </p>
        </section>
        <label className="flex items-center gap-2 text-body-md">
          <input
            type="checkbox"
            checked={v.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Offer this template when writing an email
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function TemplatesScreen() {
  const { profile } = useAuth()
  const isManager = profile !== null && canAccess(profile.role, '/tasks/new')
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<MessageTemplate | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const templates = useResource(() => listTemplates(), `templates-${version}`)

  return (
    <>
      <PageHeader
        title="Message Templates"
        subtitle="Reusable emails. Placeholders such as {{customer_name}} are filled in when you write one."
        back={{ to: '/communications', label: 'Communications' }}
        actions={
          isManager ? (
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} aria-hidden="true" /> New Template
            </Button>
          ) : undefined
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={templates} skeletonLines={4}>
        {(rows) => (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rows.map((t) => (
              <Panel
                key={t.id}
                title={t.name}
                subtitle={`Updated ${formatDate(t.updatedAt)}`}
                action={
                  isManager ? (
                    <Button
                      variant="secondary"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil size={16} aria-hidden="true" /> Edit
                    </Button>
                  ) : undefined
                }
              >
                <p className="mb-2 flex flex-wrap gap-2">
                  <Badge tone={t.purpose === 'marketing' ? 'warning' : 'info'}>
                    {t.purpose === 'marketing' ? 'Marketing' : 'Service message'}
                  </Badge>
                  {!t.isActive && <Badge>Not offered</Badge>}
                </p>
                <p className="text-body-md font-medium text-on-surface">{t.subject}</p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-body-md text-on-surface-variant">
                  {t.body}
                </p>
              </Panel>
            ))}
          </div>
        )}
      </ResourceBoundary>
      {editing && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(n) => {
            setEditing(null)
            setNotice(n)
            setVersion((x) => x + 1)
          }}
        />
      )}
    </>
  )
}
