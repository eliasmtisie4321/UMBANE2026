import { ClipboardPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { CustomerPicker } from '@/components/data/CustomerPicker'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { StaffSelect } from '@/components/sales/StaffSelect'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { useResource } from '@/hooks/useResource'
import { getCustomerTickets } from '@/services/customers'
import { getCustomerPropertyOptions } from '@/services/orders'
import { getCustomerOption } from '@/services/properties'
import { getTicket } from '@/services/support'
import { createTask, getTask, updateTask } from '@/services/tasks'
import type { Result } from '@/types/api'
import type { CustomerOption } from '@/types/properties'
import { TICKET_PRIORITIES } from '@/types/support'
import { TASK_CATEGORIES, type TaskCategory, type TaskPriority } from '@/types/team'
import { ok } from '@/utils/result'
import {
  emptyTaskForm,
  taskToForm,
  TASK_TITLE_MAX,
  toTaskInput,
  validateTaskForm,
  type TaskFormErrors,
  type TaskFormValues,
} from '@/utils/teamForm'

interface FormProps {
  mode: 'create' | 'edit'
  initial: TaskFormValues
  initialCustomer: CustomerOption | null
  assigneeName?: string | null
  submitting: boolean
  serverError: string | null
  serverFieldErrors: TaskFormErrors
  cancelTo: string
  onSubmit: (values: TaskFormValues) => void
}

function TaskForm({
  mode,
  initial,
  initialCustomer,
  assigneeName,
  submitting,
  serverError,
  serverFieldErrors,
  cancelTo,
  onSubmit,
}: FormProps) {
  const [values, setValues] = useState(initial)
  const [customer, setCustomer] = useState(initialCustomer)
  const [errors, setErrors] = useState<TaskFormErrors>({})
  const links = useResource(async () => {
    if (!values.customerId) return ok({ properties: [], tickets: [] })
    const [properties, tickets] = await Promise.all([
      getCustomerPropertyOptions(values.customerId),
      getCustomerTickets(values.customerId),
    ])
    if (!properties.ok) return properties
    return ok({ properties: properties.data, tickets: tickets.ok ? tickets.data : [] })
  }, `task-links-${values.customerId}`)
  const properties = links.status === 'ready' ? links.data.properties : []
  const tickets = links.status === 'ready' ? links.data.tickets : []
  const shown = { ...serverFieldErrors, ...errors }
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateTaskForm(values)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) return document.getElementById(`task-${first}`)?.focus()
    onSubmit(values)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {serverError && <FormError>{serverError}</FormError>}
      <FormSection title="Task" description="What needs doing, and how urgent it is.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              id="task-title"
              label="Title"
              maxLength={TASK_TITLE_MAX}
              placeholder="Replace cracked faceplate on MTR-0002"
              value={values.title}
              error={shown.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Textarea
              id="task-description"
              label="Description (optional)"
              rows={4}
              value={values.description}
              error={shown.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <Select
            id="task-category"
            label="Category"
            options={TASK_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            value={values.category}
            onChange={(e) => set('category', e.target.value as TaskCategory)}
          />
          <Select
            id="task-priority"
            label="Priority"
            options={TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
            value={values.priority}
            onChange={(e) => set('priority', e.target.value as TaskPriority)}
          />
        </div>
      </FormSection>

      <FormSection title="Who and when">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <StaffSelect
            id="task-assignedTo"
            label="Assigned to"
            emptyLabel="Nobody yet"
            value={values.assignedTo}
            currentName={assigneeName}
            error={shown.assignedTo}
            onChange={(id) => set('assignedTo', id)}
          />
          {mode === 'create' && (
            <RadioGroup
              legend="Starts as"
              value={values.status}
              options={[
                { value: 'todo', label: 'Pending' },
                { value: 'in_progress', label: 'In Progress' },
              ]}
              onChange={(s) => set('status', s)}
            />
          )}
          <Input
            id="task-startDate"
            label="Start date (optional)"
            type="date"
            value={values.startDate}
            error={shown.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          <Input
            id="task-dueDate"
            label="Due date (optional)"
            type="date"
            value={values.dueDate}
            error={shown.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
          />
          <label className="flex items-start gap-2 text-body-md text-on-surface md:col-span-2">
            <input
              type="checkbox"
              checked={values.proofRequired}
              onChange={(e) => set('proofRequired', e.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              Needs a photo of the finished work
              <span className="block text-label-md text-on-surface-variant">
                The task cannot be completed until a photo is attached.
              </span>
            </span>
          </label>
        </div>
      </FormSection>

      <FormSection
        title="Linked records (optional)"
        description="Link the customer, property or support ticket this task is for."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <CustomerPicker
              id="task-customerId"
              label="Customer"
              selected={customer}
              error={shown.customerId}
              onSelect={(c) => {
                setCustomer(c)
                setValues((v) => ({ ...v, customerId: c?.id ?? '', propertyId: '', ticketId: '' }))
              }}
            />
          </div>
          <Select
            id="task-propertyId"
            label="Property"
            options={[
              { value: '', label: 'No property' },
              ...properties.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={properties.some((p) => p.id === values.propertyId) ? values.propertyId : ''}
            disabled={!values.customerId || links.status !== 'ready'}
            error={
              shown.propertyId ??
              (links.status === 'error' ? 'The properties could not be loaded.' : undefined)
            }
            onChange={(e) => set('propertyId', e.target.value)}
          />
          <Select
            id="task-ticketId"
            label="Support ticket"
            options={[
              { value: '', label: 'No ticket' },
              ...tickets.map((t) => ({ value: t.id, label: `${t.reference}: ${t.subject}` })),
            ]}
            value={tickets.some((t) => t.id === values.ticketId) ? values.ticketId : ''}
            disabled={!values.customerId || links.status !== 'ready'}
            error={shown.ticketId}
            onChange={(e) => set('ticketId', e.target.value)}
          />
        </div>
      </FormSection>

      <div className="flex flex-wrap justify-end gap-2">
        <Link to={cancelTo} className={secondaryLink}>
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          <ClipboardPlus size={16} aria-hidden="true" />
          {mode === 'create' ? 'Create Task' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}

const fieldErrorsOf = (field: string | undefined, message: string): TaskFormErrors =>
  field && field in emptyTaskForm ? { [field]: message } : {}

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

interface Prefill {
  values: TaskFormValues
  customer: CustomerOption | null
}

/** From a ticket: its customer, property and the ticket itself; from a profile: the assignee. */
async function loadPrefill(ticketId: string, customerId: string, assignee: string) {
  const values = { ...emptyTaskForm, assignedTo: assignee }
  if (ticketId) {
    const t = await getTicket(ticketId)
    if (!t.ok) return t
    return ok<Prefill>({
      values: {
        ...values,
        title: t.data.subject,
        category: 'customer_support',
        priority: t.data.priority,
        customerId: t.data.customerId,
        propertyId: t.data.propertyId ?? '',
        ticketId: t.data.id,
      },
      customer: {
        id: t.data.customerId,
        name: t.data.customerName,
        companyName: null,
        email: null,
      },
    })
  }
  if (customerId) {
    const c = await getCustomerOption(customerId)
    if (!c.ok) return c
    return ok<Prefill>({ values: { ...values, customerId }, customer: c.data })
  }
  return ok<Prefill>({ values, customer: null })
}

export function NewTaskScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const pick = (k: string) => {
    const v = params.get(k) ?? ''
    return isUuid(v) ? v : ''
  }
  const ticketId = pick('ticket')
  const customerId = pick('customer')
  const assignee = pick('assignee')
  const prefill = useResource(
    (): Promise<Result<Prefill>> => loadPrefill(ticketId, customerId, assignee),
    `task-prefill-${ticketId}-${customerId}-${assignee}`,
  )
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<TaskFormErrors>({})
  const back = ticketId
    ? { to: `/support-tickets/${ticketId}`, label: 'Ticket details' }
    : assignee
      ? { to: `/team/${assignee}`, label: 'Employee profile' }
      : { to: '/tasks', label: 'Task Management' }

  async function save(values: TaskFormValues) {
    setSubmitting(true)
    setServerError(null)
    setFieldErrors({})
    const result = await createTask(toTaskInput(values, 'create'))
    setSubmitting(false)
    if (!result.ok) {
      setFieldErrors(fieldErrorsOf(result.error.field, result.error.message))
      return setServerError(result.error.field ? null : result.error.message)
    }
    navigate(`/tasks/${result.data.id}`, {
      state: {
        notice: values.assignedTo
          ? 'Task created and assigned. They have been notified.'
          : 'Task created. Assign it when you know who will do it.',
      },
    })
  }

  return (
    <>
      <PageHeader
        title="Create Task"
        subtitle="Assign a field job, an audit or a customer follow-up to someone on the team."
        back={back}
      />
      <ResourceBoundary state={prefill} skeletonLines={4}>
        {(p) => (
          <TaskForm
            mode="create"
            initial={p.values}
            initialCustomer={p.customer}
            submitting={submitting}
            serverError={serverError}
            serverFieldErrors={fieldErrors}
            cancelTo={back.to}
            onSubmit={(v) => void save(v)}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

export function EditTaskScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const task = useResource(() => getTask(id), `task-edit-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<TaskFormErrors>({})

  async function save(values: TaskFormValues) {
    setSubmitting(true)
    setServerError(null)
    setFieldErrors({})
    const result = await updateTask(id, toTaskInput(values, 'edit'))
    setSubmitting(false)
    if (!result.ok) {
      setFieldErrors(fieldErrorsOf(result.error.field, result.error.message))
      return setServerError(result.error.field ? null : result.error.message)
    }
    navigate(`/tasks/${id}`, { state: { notice: 'Task saved.' } })
  }

  return (
    <>
      <PageHeader title="Edit Task" back={{ to: `/tasks/${id}`, label: 'Task details' }} />
      <ResourceBoundary state={task} skeletonLines={6}>
        {(t) =>
          t.status === 'done' || t.status === 'cancelled' ? (
            <FormError>
              This task is {t.status === 'done' ? 'completed' : 'cancelled'}. Reopen it before
              changing it.
            </FormError>
          ) : (
            <TaskForm
              mode="edit"
              initial={taskToForm(t)}
              initialCustomer={
                t.customerId
                  ? { id: t.customerId, name: t.customerName ?? '', companyName: null, email: null }
                  : null
              }
              assigneeName={t.assigneeName}
              submitting={submitting}
              serverError={serverError}
              serverFieldErrors={fieldErrors}
              cancelTo={`/tasks/${id}`}
              onSubmit={(v) => void save(v)}
            />
          )
        }
      </ResourceBoundary>
    </>
  )
}
