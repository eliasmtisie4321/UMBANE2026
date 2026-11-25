import { useState, type FormEvent } from 'react'
import { FormError } from '@/components/data/ListPanel'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { createActivity, updateActivity } from '@/services/salesActivities'
import type { AppError } from '@/types/api'
import {
  ACTIVITY_KINDS,
  type ActivityKind,
  type ActivitySubject,
  type SalesActivity,
} from '@/types/sales'
import {
  activityToForm,
  emptyActivityForm,
  toActivityInput,
  validateActivityForm,
  type ActivityFormErrors,
  type ActivityFormValues,
} from '@/utils/salesForm'
import { StaffSelect } from './StaffSelect'

type ActivityDialogProps = {
  onClose: () => void
  onSaved: () => void
} & ({ item: SalesActivity; subject?: never } | { item: null; subject: ActivitySubject })

/** Add or update a call, meeting or task. Mount it to open it. */
export function ActivityDialog({ item, subject, onClose, onSaved }: ActivityDialogProps) {
  const [values, setValues] = useState<ActivityFormValues>(
    item ? activityToForm(item) : emptyActivityForm,
  )
  const [errors, setErrors] = useState<ActivityFormErrors>({})
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateActivityForm(values)
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    const input = toActivityInput(values)
    const result = item
      ? await updateActivity(item.id, input)
      : await createActivity(subject, input)
    setSaving(false)
    if (result.ok) onSaved()
    else setServerError(result.error)
  }

  return (
    <Modal open title={item ? 'Update activity' : 'Add activity'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {serverError && serverError.field !== 'assignedTo' && (
          <FormError>{serverError.message}</FormError>
        )}
        <Input
          id="act-subject"
          label="Subject"
          placeholder="e.g. Proposal review call"
          value={values.subject}
          onChange={(e) => set('subject', e.target.value)}
          error={errors.subject}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            id="act-kind"
            label="Type"
            options={ACTIVITY_KINDS}
            value={values.kind}
            onChange={(e) => set('kind', e.target.value as ActivityKind)}
          />
          <Input
            id="act-dueOn"
            label="Due date (optional)"
            type="date"
            value={values.dueOn}
            onChange={(e) => set('dueOn', e.target.value)}
            error={errors.dueOn}
          />
        </div>
        <StaffSelect
          id="act-assignedTo"
          label="Assigned to"
          value={values.assignedTo}
          currentName={item?.assignedName}
          error={serverError?.field === 'assignedTo' ? serverError.message : undefined}
          onChange={(id) => set('assignedTo', id)}
        />
        <Textarea
          id="act-outcome"
          label="Notes or outcome (optional)"
          rows={3}
          value={values.outcome}
          onChange={(e) => set('outcome', e.target.value)}
          error={errors.outcome}
        />
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={values.done}
            onChange={(e) => set('done', e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          This is done
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save activity
          </Button>
        </div>
      </form>
    </Modal>
  )
}
