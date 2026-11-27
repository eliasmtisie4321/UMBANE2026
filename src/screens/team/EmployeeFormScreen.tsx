import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormSection } from '@/components/data/FormSection'
import { FormError } from '@/components/data/ListPanel'
import { secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input, Select } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  getTeamMember,
  invitationAction,
  inviteStaff,
  listTeam,
  updateEmployee,
  type InvitationOutcome,
} from '@/services/team'
import { copyText } from '@/utils/browser'
import {
  DEPARTMENTS,
  EMPLOYMENT_STATUSES,
  STAFF_ROLES,
  type Department,
  type EmploymentStatus,
  type StaffRole,
} from '@/types/team'
import {
  emptyEmployeeForm,
  memberToForm,
  toEmployeeUpdate,
  toInviteInput,
  validateEmployeeForm,
  type EmployeeFormErrors,
  type EmployeeFormValues,
} from '@/utils/teamForm'

interface FormProps {
  mode: 'invite' | 'edit'
  initial: EmployeeFormValues
  /** The person being edited, who cannot report to themselves. */
  selfId?: string
  /** The signed-in administrator cannot change their own role. */
  lockRole: boolean
  submitting: boolean
  serverError: string | null
  serverFieldErrors: EmployeeFormErrors
  cancelTo: string
  onSubmit: (values: EmployeeFormValues) => void
}

function EmployeeForm({
  mode,
  initial,
  selfId,
  lockRole,
  submitting,
  serverError,
  serverFieldErrors,
  cancelTo,
  onSubmit,
}: FormProps) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<EmployeeFormErrors>({})
  const team = useResource(() => listTeam(), 'team-managers')
  const managers = (team.data ?? []).filter((m) => m.isActive && m.id !== selfId)
  const shown = { ...serverFieldErrors, ...errors }
  const set = <K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateEmployeeForm(values, mode)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) return document.getElementById(`employee-${first}`)?.focus()
    onSubmit(values)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {serverError && <FormError>{serverError}</FormError>}
      <FormSection title="Personal and contact details">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="employee-fullName"
            label="Full name"
            autoComplete="off"
            value={values.fullName}
            error={shown.fullName}
            onChange={(e) => set('fullName', e.target.value)}
          />
          {mode === 'invite' ? (
            <Input
              id="employee-email"
              label="Work email"
              type="email"
              hint="They sign in with this address."
              value={values.email}
              error={shown.email}
              onChange={(e) => set('email', e.target.value)}
            />
          ) : (
            <p className="self-end text-body-md">
              <span className="text-on-surface-variant">Email: </span>
              {values.email || '-'}
            </p>
          )}
          <Input
            id="employee-phone"
            label="Phone (optional)"
            type="tel"
            placeholder="082 123 4567"
            value={values.phone}
            error={shown.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </FormSection>

      <FormSection
        title="Employment and access"
        description="The access level decides what they can see and change in Umbane."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select
            id="employee-department"
            label="Department"
            options={[{ value: '', label: 'No department' }, ...DEPARTMENTS]}
            value={values.department}
            onChange={(e) => set('department', e.target.value as Department | '')}
          />
          <Input
            id="employee-jobTitle"
            label="Job title"
            placeholder="Field Technician"
            value={values.jobTitle}
            error={shown.jobTitle}
            onChange={(e) => set('jobTitle', e.target.value)}
          />
          <Select
            id="employee-role"
            label="Access level"
            options={STAFF_ROLES.map((r) => ({ value: r.value, label: r.label }))}
            value={values.role}
            disabled={lockRole}
            hint={lockRole ? 'You cannot change your own access level.' : undefined}
            error={shown.role}
            onChange={(e) => set('role', e.target.value as StaffRole)}
          />
          <Select
            id="employee-reportsTo"
            label="Reports to"
            options={[
              { value: '', label: 'Nobody' },
              ...managers.map((m) => ({ value: m.id, label: m.fullName })),
            ]}
            value={values.reportsTo}
            error={shown.reportsTo}
            onChange={(e) => set('reportsTo', e.target.value)}
          />
          <Input
            id="employee-startDate"
            label="Start date (optional)"
            type="date"
            value={values.startDate}
            error={shown.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          {mode === 'edit' && (
            <Select
              id="employee-employmentStatus"
              label="Status"
              options={EMPLOYMENT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              value={values.employmentStatus}
              onChange={(e) => set('employmentStatus', e.target.value as EmploymentStatus)}
            />
          )}
        </div>
      </FormSection>

      <div className="flex flex-wrap justify-end gap-2">
        <Link to={cancelTo} className={secondaryLink}>
          Cancel
        </Link>
        <Button type="submit" loading={submitting}>
          <Check size={16} aria-hidden="true" />
          {mode === 'invite' ? 'Add Employee' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}

const fieldErrorsOf = (field: string | undefined, message: string): EmployeeFormErrors =>
  field && field in emptyEmployeeForm ? { [field]: message } : {}

export function NewEmployeeScreen() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<EmployeeFormErrors>({})
  const [invited, setInvited] = useState<EmployeeFormValues | null>(null)
  const [invitationId, setInvitationId] = useState<string | null>(null)
  const [delivery, setDelivery] = useState<
    InvitationOutcome | { state: 'error'; error: string } | null
  >(null)
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  /** Sends the invitation through the business's email (Settings → Integrations). */
  async function deliver(id: string, action: 'send' | 'resend' | 'link') {
    setSending(true)
    const r = await invitationAction(action, id)
    setSending(false)
    if (!r.ok) return setDelivery({ state: 'error', error: r.error.message })
    if (r.data.state === 'link') {
      if (await copyText(r.data.link))
        setCopied('The invitation link is copied. Share it only with them.')
      else setCopied(r.data.link)
      return
    }
    setDelivery(r.data)
  }

  async function save(values: EmployeeFormValues) {
    setSubmitting(true)
    setServerError(null)
    setFieldErrors({})
    const result = await inviteStaff(toInviteInput(values))
    setSubmitting(false)
    if (!result.ok) {
      setFieldErrors(fieldErrorsOf(result.error.field, result.error.message))
      return setServerError(result.error.field ? null : result.error.message)
    }
    if (result.data.status === 'linked') {
      return navigate(`/team/${result.data.profileId}`, {
        state: { notice: `${values.fullName.trim()} has been added to the team.` },
      })
    }
    setInvited(values)
    setInvitationId(result.data.invitationId)
    setDelivery(null)
    setCopied(null)
    await deliver(result.data.invitationId, 'send')
  }

  if (invited) {
    const email = invited.email.trim().toLowerCase()
    return (
      <>
        <PageHeader title="Invitation" back={{ to: '/team', label: 'Team' }} />
        <section
          aria-label="Next step"
          className="max-w-2xl rounded-lg border border-outline-variant bg-surface p-6 shadow-card"
        >
          <p className="text-body-md text-on-surface">
            <strong>{invited.fullName.trim()}</strong> is saved and waiting to join.
          </p>
          <div role="status" className="mt-3 text-body-md text-on-surface">
            {sending && !delivery && <p>Sending the invitation to {email}…</p>}
            {delivery?.state === 'sent' && (
              <p>
                The invitation was emailed to <span className="font-mono">{email}</span>
                {delivery.via ? ` through ${delivery.via}` : ''}. When they open the link and set a
                password, they join with the details you entered.
              </p>
            )}
            {(delivery?.state === 'failed' || delivery?.state === 'error') && (
              <p className="text-error">
                The invitation could not be emailed: {delivery.error} You can try again, or copy the
                link and share it with them another way.
              </p>
            )}
          </div>
          {copied && (
            <p className="mt-2 break-all text-label-md text-on-surface-variant">{copied}</p>
          )}
          <p className="mt-3 text-body-md text-on-surface-variant">
            Until they accept, they appear under “Waiting to join” on the Team page, where you can
            resend, copy the link or cancel the invitation. It stays open for 7 days.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {invitationId && delivery && delivery.state !== 'sent' && (
              <Button loading={sending} onClick={() => void deliver(invitationId, 'resend')}>
                Try Again
              </Button>
            )}
            {invitationId && (
              <Button
                variant="secondary"
                disabled={sending}
                onClick={() => void deliver(invitationId, 'link')}
              >
                Copy Invitation Link
              </Button>
            )}
            <Link to="/team" className={secondaryLink}>
              Back to Team
            </Link>
            <Button variant="secondary" onClick={() => setInvited(null)}>
              Add Another Employee
            </Button>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Add Employee"
        subtitle="Create their staff profile and choose what they can access."
        back={{ to: '/team', label: 'Team' }}
      />
      <EmployeeForm
        key="invite"
        mode="invite"
        initial={emptyEmployeeForm}
        lockRole={false}
        submitting={submitting}
        serverError={serverError}
        serverFieldErrors={fieldErrors}
        cancelTo="/team"
        onSubmit={(v) => void save(v)}
      />
    </>
  )
}

export function EditEmployeeScreen() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const member = useResource(() => getTeamMember(id), `employee-edit-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<EmployeeFormErrors>({})

  async function save(values: EmployeeFormValues) {
    setSubmitting(true)
    setServerError(null)
    setFieldErrors({})
    const result = await updateEmployee(id, toEmployeeUpdate(values))
    setSubmitting(false)
    if (!result.ok) {
      setFieldErrors(fieldErrorsOf(result.error.field, result.error.message))
      return setServerError(result.error.field ? null : result.error.message)
    }
    navigate(`/team/${id}`, { state: { notice: 'Employee details saved.' } })
  }

  return (
    <>
      <PageHeader title="Edit Employee" back={{ to: `/team/${id}`, label: 'Employee profile' }} />
      <ResourceBoundary state={member} skeletonLines={6}>
        {(m) => (
          <EmployeeForm
            mode="edit"
            initial={memberToForm(m)}
            selfId={m.id}
            lockRole={m.id === profile?.id}
            submitting={submitting}
            serverError={serverError}
            serverFieldErrors={fieldErrors}
            cancelTo={`/team/${id}`}
            onSubmit={(v) => void save(v)}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
