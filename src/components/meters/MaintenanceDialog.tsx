import { useState, type FormEvent } from 'react'
import { Button, Modal, Select, Textarea, Input } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { createMaintenance, listStaffOptions, updateMaintenance } from '@/services/maintenance'
import type { AppError } from '@/types/api'
import {
  MAINTENANCE_KINDS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  type MaintenanceItem,
  type MaintenanceKind,
  type MaintenancePriority,
  type MaintenanceStatus,
  type MeterOption,
} from '@/types/meters'
import { humanize } from '@/utils/format'
import {
  emptyMaintenanceForm,
  toMaintenanceInput,
  validateMaintenanceForm,
  type MaintenanceFormErrors,
  type MaintenanceFormValues,
} from '@/utils/meterForm'
import { MeterPicker } from './MeterPicker'

interface MaintenanceDialogProps {
  /** The work order to update, or null to schedule a new one. */
  item: MaintenanceItem | null
  /** The meter for a new work order, when it is already known. */
  meter?: MeterOption | null
  onClose: () => void
  onSaved: () => void
}

/** Schedule or update a work order. Mount it to open it; unmount it to close it. */
export function MaintenanceDialog({ item, meter, onClose, onSaved }: MaintenanceDialogProps) {
  const [chosen, setChosen] = useState<MeterOption | null>(meter ?? null)
  const [values, setValues] = useState<MaintenanceFormValues>(
    item
      ? {
          kind: item.kind,
          issue: item.issue,
          priority: item.priority,
          status: item.status,
          scheduledFor: item.scheduledFor ?? '',
          assignedTo: item.assignedTo ?? '',
          outcome: item.outcome ?? '',
        }
      : emptyMaintenanceForm,
  )
  const [errors, setErrors] = useState<MaintenanceFormErrors & { meter?: string }>({})
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)
  const staff = useResource(() => listStaffOptions(), 'staff-options')

  const set = <K extends keyof MaintenanceFormValues>(key: K, value: MaintenanceFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }
  const fieldError = (key: keyof MaintenanceFormValues) =>
    errors[key] ?? (serverError?.field === key ? serverError.message : undefined)

  // Someone who has since left the team stays selectable on their own work order.
  const people = staff.data ?? []
  const staffOptions = [
    { value: '', label: 'Not assigned' },
    ...people.map((p) => ({ value: p.id, label: p.name })),
    ...(item?.assignedTo && !people.some((p) => p.id === item.assignedTo)
      ? [{ value: item.assignedTo, label: item.assignedName ?? 'Current technician' }]
      : []),
  ]
  const kindOptions = MAINTENANCE_KINDS.some((k) => k.value === values.kind)
    ? MAINTENANCE_KINDS
    : [...MAINTENANCE_KINDS, { value: values.kind, label: humanize(values.kind) }]

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: typeof errors = validateMaintenanceForm(values)
    if (!item && !chosen) found.meter = 'Choose the meter.'
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    const input = toMaintenanceInput(values)
    const result = item
      ? await updateMaintenance(item.id, input)
      : await createMaintenance(chosen!.id, input)
    setSaving(false)
    if (result.ok) onSaved()
    else setServerError(result.error)
  }

  return (
    <Modal
      open
      title={item ? `Update ${item.reference}` : 'Schedule maintenance'}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && !serverError.field && (
          <p
            role="alert"
            className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
          >
            {serverError.message}
          </p>
        )}
        {item ? (
          <p className="text-body-md text-on-surface-variant">
            <span className="font-mono">{item.serialNumber}</span> · {item.propertyName}
          </p>
        ) : meter ? (
          <p className="text-body-md text-on-surface-variant">
            <span className="font-mono">{meter.serialNumber}</span> · {meter.propertyName}
          </p>
        ) : (
          <MeterPicker
            id="mnt-meter"
            selected={chosen}
            error={errors.meter}
            onSelect={(m) => {
              setChosen(m)
              setErrors((x) => ({ ...x, meter: undefined }))
            }}
          />
        )}
        <Textarea
          id="mnt-issue"
          label="Issue or task"
          rows={2}
          placeholder="e.g. Tamper seal inspection due"
          value={values.issue}
          onChange={(e) => set('issue', e.target.value)}
          error={fieldError('issue')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            id="mnt-kind"
            label="Type of work"
            options={kindOptions}
            value={values.kind}
            onChange={(e) => set('kind', e.target.value as MaintenanceKind)}
          />
          <Select
            id="mnt-priority"
            label="Priority"
            options={MAINTENANCE_PRIORITIES}
            value={values.priority}
            onChange={(e) => set('priority', e.target.value as MaintenancePriority)}
          />
          <Input
            id="mnt-scheduledFor"
            label="Scheduled date"
            type="date"
            value={values.scheduledFor}
            onChange={(e) => set('scheduledFor', e.target.value)}
            error={fieldError('scheduledFor')}
          />
          <Select
            id="mnt-assignedTo"
            label="Technician"
            options={staffOptions}
            value={values.assignedTo}
            onChange={(e) => set('assignedTo', e.target.value)}
            error={
              fieldError('assignedTo') ??
              (staff.status === 'error' ? 'The team list could not be loaded.' : undefined)
            }
          />
          <Select
            id="mnt-status"
            label="Status"
            options={
              item
                ? MAINTENANCE_STATUSES
                : MAINTENANCE_STATUSES.filter((s) => s.value !== 'cancelled')
            }
            value={values.status}
            onChange={(e) => set('status', e.target.value as MaintenanceStatus)}
          />
        </div>
        {(values.status === 'completed' || values.status === 'cancelled' || values.outcome) && (
          <Textarea
            id="mnt-outcome"
            label="Outcome"
            rows={2}
            placeholder="What was done or found"
            value={values.outcome}
            onChange={(e) => set('outcome', e.target.value)}
            error={fieldError('outcome')}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {item ? 'Save changes' : 'Create work order'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
