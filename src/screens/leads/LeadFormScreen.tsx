import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { StaffSelect } from '@/components/sales/StaffSelect'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { createLead, getLead, updateLead } from '@/services/leads'
import type { AppError } from '@/types/api'
import { LEAD_SOURCES, LEAD_STAGES, type LeadSource, type LeadStage } from '@/types/sales'
import {
  emptyLeadForm,
  leadToForm,
  toLeadInput,
  validateLeadForm,
  type LeadFormErrors,
  type LeadFormValues,
} from '@/utils/salesForm'

const FIELD_ORDER: Array<keyof LeadFormValues> = [
  'name',
  'companyName',
  'email',
  'phone',
  'source',
  'serviceInterest',
  'estimatedValue',
  'expectedClose',
  'followUpOn',
  'notes',
]
const SOURCE_OPTIONS = [{ value: '', label: 'Select lead source' }, ...LEAD_SOURCES]

interface LeadFormProps {
  initial: LeadFormValues
  assignedName?: string | null
  mode: 'create' | 'edit'
  /** A converted or lost lead's stage is changed on its page, not here. */
  closed?: boolean
  submitting: boolean
  serverError: AppError | null
  cancelTo: string
  onSubmit: (values: LeadFormValues) => void
}

function LeadForm({
  initial,
  assignedName,
  mode,
  closed = false,
  submitting,
  serverError,
  cancelTo,
  onSubmit,
}: LeadFormProps) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<LeadFormErrors>({})

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateLeadForm(values)
    setErrors(found)
    const first = FIELD_ORDER.find((k) => found[k])
    if (first) {
      document.getElementById(`lead-${first}`)?.focus()
      return
    }
    onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {serverError && <FormError>{serverError.message}</FormError>}
      <FormSection title="Contact">
        <Input
          id="lead-name"
          label="Contact name"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <Input
          id="lead-companyName"
          label="Company (optional)"
          value={values.companyName}
          onChange={(e) => set('companyName', e.target.value)}
          error={errors.companyName}
        />
        <Input
          id="lead-email"
          label="Email address"
          type="email"
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
        />
        <Input
          id="lead-phone"
          label="Phone number"
          type="tel"
          placeholder="082 441 9082"
          value={values.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={errors.phone}
        />
      </FormSection>
      <FormSection title="Opportunity">
        <Select
          id="lead-source"
          label="Lead source"
          options={SOURCE_OPTIONS}
          value={values.source}
          onChange={(e) => set('source', e.target.value as LeadSource | '')}
          error={errors.source}
        />
        <Input
          id="lead-serviceInterest"
          label="Interested in (optional)"
          placeholder="e.g. Smart prepaid sub-metering"
          value={values.serviceInterest}
          onChange={(e) => set('serviceInterest', e.target.value)}
          error={errors.serviceInterest}
        />
        <Input
          id="lead-estimatedValue"
          label="Estimated value in rand (optional)"
          inputMode="decimal"
          placeholder="e.g. 240000"
          value={values.estimatedValue}
          onChange={(e) => set('estimatedValue', e.target.value)}
          error={errors.estimatedValue}
        />
        {!closed && (
          <Select
            id="lead-stage"
            label="Stage"
            options={LEAD_STAGES}
            value={values.stage}
            onChange={(e) => set('stage', e.target.value as LeadStage)}
            error={errors.stage}
          />
        )}
        <StaffSelect
          id="lead-assignedTo"
          label="Assigned to"
          value={values.assignedTo}
          currentName={assignedName}
          error={serverError?.field === 'assignedTo' ? serverError.message : undefined}
          onChange={(id) => set('assignedTo', id)}
        />
        <Input
          id="lead-followUpOn"
          label="Next follow-up (optional)"
          type="date"
          value={values.followUpOn}
          onChange={(e) => set('followUpOn', e.target.value)}
          error={errors.followUpOn}
        />
        <Input
          id="lead-expectedClose"
          label="Expected closing date (optional)"
          type="date"
          value={values.expectedClose}
          onChange={(e) => set('expectedClose', e.target.value)}
          error={errors.expectedClose}
        />
        <div className="sm:col-span-2">
          <Textarea
            id="lead-notes"
            label="Notes (optional)"
            rows={4}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            error={errors.notes}
          />
        </div>
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Link to={cancelTo} className={secondaryLink}>
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Save Lead' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

export function NewLeadScreen() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  async function save(values: LeadFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await createLead(toLeadInput(values))
    setSubmitting(false)
    if (result.ok) navigate(`/leads/${result.data.id}`, { state: { notice: 'Lead added.' } })
    else setError(result.error)
  }

  return (
    <>
      <PageHeader
        title="Add New Lead"
        subtitle="Capture a prospective customer and assign it to someone."
        back={{ to: '/leads', label: 'Leads' }}
      />
      <LeadForm
        initial={emptyLeadForm}
        mode="create"
        submitting={submitting}
        serverError={error}
        cancelTo="/leads"
        onSubmit={save}
      />
    </>
  )
}

export function EditLeadScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(() => getLead(id), `lead-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  return (
    <>
      <PageHeader
        title="Edit Lead"
        subtitle={state.data ? (state.data.companyName ?? state.data.name) : undefined}
        back={{ to: `/leads/${id}`, label: 'Lead details' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(lead) => (
          <LeadForm
            key={lead.id}
            initial={leadToForm(lead)}
            assignedName={lead.assignedName}
            mode="edit"
            closed={!lead.isOpen}
            submitting={submitting}
            serverError={error}
            cancelTo={`/leads/${id}`}
            onSubmit={async (values) => {
              setSubmitting(true)
              setError(null)
              const result = await updateLead(id, toLeadInput(values, !lead.isOpen))
              setSubmitting(false)
              if (result.ok) navigate(`/leads/${id}`, { state: { notice: 'Lead updated.' } })
              else setError(result.error)
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
