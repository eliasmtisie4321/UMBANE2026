import { Paperclip, Send, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { CustomerPicker } from '@/components/data/CustomerPicker'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { StaffSelect } from '@/components/sales/StaffSelect'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { useTicketCategories } from '@/hooks/useTicketCategories'
import { getCustomerOption } from '@/services/properties'
import {
  createTicket,
  getTicket,
  getTicketAssets,
  updateTicketDetails,
  uploadAttachment,
} from '@/services/support'
import type { CustomerOption } from '@/types/properties'
import {
  TICKET_PRIORITIES,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
} from '@/types/support'
import { formatNumber } from '@/utils/format'
import { ok } from '@/utils/result'
import {
  checkFiles,
  emptyTicketForm,
  FILE_ACCEPT,
  FILE_HINT,
  formatBytes,
  SUBJECT_MAX,
  toTicketInput,
  validateTicketForm,
  type TicketFormErrors,
  type TicketFormValues,
} from '@/utils/ticketForm'

interface FormProps {
  mode: 'create' | 'edit'
  initial: TicketFormValues
  initialCustomer: CustomerOption | null
  /** Staff choose the customer, priority and assignee; clients describe the problem. */
  isStaff: boolean
  submitting: boolean
  serverError: string | null
  serverFieldErrors: TicketFormErrors
  cancelTo: string
  onSubmit: (values: TicketFormValues, files: File[]) => void
}

function TicketForm({
  mode,
  initial,
  initialCustomer,
  isStaff,
  submitting,
  serverError,
  serverFieldErrors,
  cancelTo,
  onSubmit,
}: FormProps) {
  const categories = useTicketCategories()
  const [values, setValues] = useState(initial)
  const [customer, setCustomer] = useState(initialCustomer)
  const [errors, setErrors] = useState<TicketFormErrors>({})
  const [files, setFiles] = useState<File[]>([])
  const [fileProblems, setFileProblems] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const assetsFor = isStaff ? values.customerId : 'own'
  const assets = useResource(
    () =>
      isStaff && !values.customerId
        ? Promise.resolve(ok([]))
        : getTicketAssets(isStaff ? values.customerId : null),
    `ticket-assets-${assetsFor}`,
  )
  const properties = assets.status === 'ready' ? assets.data : []
  const chosen = properties.find((p) => p.id === values.propertyId)
  const meters = (chosen ? [chosen] : properties).flatMap((p) =>
    p.meters.map((m) => ({ ...m, propertyId: p.id, propertyName: p.name })),
  )
  // A field the person has changed since saving no longer shows the server's message.
  const shown = { ...serverFieldErrors, ...errors }

  const set = <K extends keyof TicketFormValues>(key: K, value: TicketFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function addFiles(picked: File[]) {
    const { accepted, problems } = checkFiles(picked, files.length)
    setFiles((f) => [...f, ...accepted])
    setFileProblems(problems)
    if (fileInput.current) fileInput.current.value = ''
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateTicketForm(values, { needsCustomer: isStaff && mode === 'create' })
    setErrors(found)
    if (Object.keys(found).length > 0) {
      document.getElementById(`ticket-${Object.keys(found)[0]}`)?.focus()
      return
    }
    onSubmit(values, files)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {serverError && <FormError>{serverError}</FormError>}
      <FormSection
        title={isStaff ? 'Customer and linked assets' : 'Where is the problem?'}
        description={
          isStaff ? undefined : 'Choose the property or meter if the problem is about one.'
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {isStaff && mode === 'create' && (
            <div className="md:col-span-2">
              <CustomerPicker
                id="ticket-customerId"
                label="Customer"
                selected={customer}
                error={shown.customerId}
                onSelect={(c) => {
                  setCustomer(c)
                  setValues((v) => ({ ...v, customerId: c?.id ?? '', propertyId: '', meterId: '' }))
                  setErrors((e) => ({ ...e, customerId: undefined }))
                }}
              />
            </div>
          )}
          {isStaff && mode === 'edit' && customer && (
            <p className="text-body-md md:col-span-2">
              <span className="text-on-surface-variant">Customer: </span>
              <span className="font-semibold">{customer.name}</span>
            </p>
          )}
          <Select
            id="ticket-propertyId"
            label="Property (optional)"
            options={[
              { value: '', label: 'Not about a property' },
              ...properties.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={chosen ? values.propertyId : ''}
            disabled={assets.status !== 'ready' || properties.length === 0}
            error={
              shown.propertyId ??
              (assets.status === 'error' ? 'The properties could not be loaded.' : undefined)
            }
            onChange={(e) => {
              const next = e.target.value
              setErrors((er) => ({ ...er, propertyId: undefined, meterId: undefined }))
              setValues((v) => ({
                ...v,
                propertyId: next,
                meterId: properties
                  .find((p) => p.id === next)
                  ?.meters.some((m) => m.id === v.meterId)
                  ? v.meterId
                  : '',
              }))
            }}
          />
          <Select
            id="ticket-meterId"
            label="Meter (optional)"
            options={[
              { value: '', label: 'Not about a meter' },
              ...meters.map((m) => ({
                value: m.id,
                label: chosen ? m.serialNumber : `${m.serialNumber} (${m.propertyName})`,
              })),
            ]}
            value={meters.some((m) => m.id === values.meterId) ? values.meterId : ''}
            disabled={assets.status !== 'ready' || meters.length === 0}
            error={shown.meterId}
            onChange={(e) => {
              const meter = meters.find((m) => m.id === e.target.value)
              setErrors((er) => ({ ...er, propertyId: undefined, meterId: undefined }))
              setValues((v) => ({
                ...v,
                meterId: e.target.value,
                propertyId: meter ? meter.propertyId : v.propertyId,
              }))
            }}
          />
          {isStaff && mode === 'create' && (
            <StaffSelect
              id="ticket-assignedTo"
              label="Assign to (optional)"
              emptyLabel="Nobody yet"
              value={values.assignedTo}
              error={shown.assignedTo}
              onChange={(id) => set('assignedTo', id)}
            />
          )}
          {isStaff && (
            <Select
              id="ticket-priority"
              label="Priority"
              options={TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
              value={values.priority}
              onChange={(e) => set('priority', e.target.value as TicketPriority)}
            />
          )}
        </div>
      </FormSection>

      <FormSection title="The problem">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="ticket-subject"
            label="Title"
            hint={isStaff ? undefined : 'For example: Prepaid token rejected'}
            maxLength={SUBJECT_MAX}
            value={values.subject}
            error={shown.subject}
            onChange={(e) => set('subject', e.target.value)}
          />
          <Select
            id="ticket-category"
            label="Category"
            options={[{ value: '', label: 'Choose a category' }, ...categories.options]}
            value={values.category}
            error={shown.category}
            onChange={(e) => set('category', e.target.value as TicketCategory | '')}
          />
          <div className="md:col-span-2">
            <Textarea
              id="ticket-description"
              label="Description"
              hint={
                isStaff
                  ? 'The customer can see this.'
                  : 'What happened, when it started, and any error shown on the meter.'
              }
              rows={6}
              value={values.description}
              error={shown.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>
      </FormSection>

      {mode === 'create' && (
        <FormSection title="Photos and documents (optional)" description={FILE_HINT}>
          <input
            ref={fileInput}
            id="ticket-files"
            type="file"
            multiple
            accept={FILE_ACCEPT}
            className="sr-only"
            aria-label="Add files"
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          />
          <div>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <Paperclip size={16} aria-hidden="true" /> Add Files
            </Button>
          </div>
          {fileProblems.length > 0 && (
            <div className="mt-3">
              <FormError>
                <ul>
                  {fileProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </FormError>
            </div>
          )}
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-outline-variant" aria-label="Files to attach">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-body-md">{f.name}</span>
                  <span className="text-label-md text-on-surface-variant">
                    {formatBytes(f.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                    className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Link to={cancelTo} className={secondaryLink}>
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          <Send size={16} aria-hidden="true" />
          {mode === 'edit' ? 'Save Changes' : isStaff ? 'Create Ticket' : 'Submit Ticket'}
        </Button>
      </div>
    </form>
  )
}

const fieldErrorsOf = (field: string | undefined, message: string): TicketFormErrors =>
  field && field in emptyTicketForm ? { [field]: message } : {}

export function NewTicketScreen() {
  const { profile } = useAuth()
  const isStaff = profile !== null && profile.role !== 'client'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const rawCustomer = params.get('customer') ?? ''
  const customerId = isStaff && /^[0-9a-f-]{36}$/i.test(rawCustomer) ? rawCustomer : ''
  const prefill = useResource(
    () => (customerId ? getCustomerOption(customerId) : Promise.resolve(ok(null))),
    `ticket-prefill-${customerId}`,
  )
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<TicketFormErrors>({})
  const back = customerId
    ? { to: `/customers/${customerId}`, label: 'Customer profile' }
    : { to: '/support-tickets', label: isStaff ? 'Support Tickets' : 'Support' }

  async function save(values: TicketFormValues, files: File[]) {
    if (!profile) return
    setSubmitting(true)
    setServerError(null)
    setFieldErrors({})
    const created = await createTicket(toTicketInput(values, isStaff))
    if (!created.ok) {
      setSubmitting(false)
      setFieldErrors(fieldErrorsOf(created.error.field, created.error.message))
      return setServerError(created.error.field ? null : created.error.message)
    }
    const failed: string[] = []
    for (const f of files) {
      const r = await uploadAttachment({ id: created.data.id, businessId: profile.business_id }, f)
      if (!r.ok) failed.push(f.name)
    }
    const notice =
      failed.length === 0
        ? `Ticket ${created.data.reference} opened.`
        : `Ticket ${created.data.reference} opened, but ${formatNumber(failed.length)} ${failed.length === 1 ? 'file' : 'files'} could not be attached (${failed.join(', ')}). Attach them again below.`
    navigate(`/support-tickets/${created.data.id}`, { state: { notice } })
  }

  return (
    <>
      <PageHeader
        title={isStaff ? 'Create Support Ticket' : 'Report a Problem'}
        subtitle={
          isStaff
            ? 'Log a metering fault, prepaid token problem or billing question for a customer.'
            : 'Tell us what is wrong and we will get back to you here.'
        }
        back={back}
      />
      <ResourceBoundary state={prefill} skeletonLines={4}>
        {(customer) => (
          <TicketForm
            mode="create"
            isStaff={isStaff}
            initial={{ ...emptyTicketForm, customerId: customer?.id ?? '' }}
            initialCustomer={customer}
            submitting={submitting}
            serverError={serverError}
            serverFieldErrors={fieldErrors}
            cancelTo={back.to}
            onSubmit={(v, f) => void save(v, f)}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

const ticketToForm = (t: Ticket): TicketFormValues => ({
  customerId: t.customerId,
  subject: t.subject,
  description: t.description ?? '',
  category: t.category,
  propertyId: t.propertyId ?? '',
  meterId: t.meterId ?? '',
  priority: t.priority,
  assignedTo: t.assignedTo ?? '',
})

export function EditTicketScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const ticket = useResource(() => getTicket(id), `ticket-edit-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<TicketFormErrors>({})

  async function save(values: TicketFormValues) {
    setSubmitting(true)
    setServerError(null)
    setFieldErrors({})
    const input = toTicketInput(values, true)
    const result = await updateTicketDetails(id, {
      subject: input.subject,
      description: input.description,
      category: input.category,
      propertyId: input.propertyId,
      meterId: input.meterId,
      priority: input.priority,
    })
    setSubmitting(false)
    if (!result.ok) {
      setFieldErrors(fieldErrorsOf(result.error.field, result.error.message))
      return setServerError(result.error.field ? null : result.error.message)
    }
    navigate(`/support-tickets/${id}`, { state: { notice: 'Ticket details saved.' } })
  }

  return (
    <>
      <PageHeader
        title="Edit Ticket"
        back={{ to: `/support-tickets/${id}`, label: 'Ticket details' }}
      />
      <ResourceBoundary state={ticket} skeletonLines={6}>
        {(t) =>
          t.status === 'closed' ? (
            <FormError>This ticket is closed, so it can no longer be changed.</FormError>
          ) : (
            <TicketForm
              mode="edit"
              isStaff
              initial={ticketToForm(t)}
              initialCustomer={{
                id: t.customerId,
                name: t.customerName,
                companyName: null,
                email: null,
              }}
              submitting={submitting}
              serverError={serverError}
              serverFieldErrors={fieldErrors}
              cancelTo={`/support-tickets/${id}`}
              onSubmit={(v) => void save(v)}
            />
          )
        }
      </ResourceBoundary>
    </>
  )
}
