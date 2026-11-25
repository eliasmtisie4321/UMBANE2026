import { useState, type FormEvent } from 'react'
import { Button, Input, Modal, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { retireMeter } from '@/services/meters'
import type { AppError } from '@/types/api'
import type { Meter } from '@/types/meters'
import { businessToday } from '@/utils/consumption'
import {
  toRetireInput,
  validateRetireForm,
  type RetireFormErrors,
  type RetireFormValues,
} from '@/utils/meterForm'

interface RetireDialogProps {
  meter: Meter
  onClose: () => void
  onDone: (newMeterId: string | null) => void
}

/** The service names fields after readings and meters; here they belong to this form's fields. */
const FIELD_ALIAS: Record<string, keyof RetireFormValues> = {
  readingValue: 'finalReading',
  readingDate: 'retiredOn',
  serialNumber: 'newSerialNumber',
  retiredOn: 'retiredOn',
  installedOn: 'retiredOn',
}

/** Take a meter out of service, with or without a replacement. Mount it to open it. */
export function RetireDialog({ meter, onClose, onDone }: RetireDialogProps) {
  const [values, setValues] = useState<RetireFormValues>({
    action: 'replace',
    retiredOn: businessToday(),
    finalReading: '',
    newSerialNumber: '',
    newInitialReading: '0',
    reason: '',
  })
  const [errors, setErrors] = useState<RetireFormErrors>({})
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof RetireFormValues>(key: K, value: RetireFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }
  const serverField = serverError?.field ? FIELD_ALIAS[serverError.field] : undefined
  const fieldError = (key: keyof RetireFormValues) =>
    errors[key] ?? (serverField === key ? serverError?.message : undefined)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateRetireForm(values)
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    const result = await retireMeter(meter.id, toRetireInput(values))
    setSaving(false)
    if (result.ok) onDone(result.data.newMeterId)
    else setServerError(result.error)
  }

  const replacing = values.action === 'replace'
  return (
    <Modal open title={`Take ${meter.serialNumber} out of service`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && !serverField && (
          <p
            role="alert"
            className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
          >
            {serverError.message}
          </p>
        )}
        <RadioGroup
          legend="What is happening?"
          value={values.action}
          onChange={(v) => set('action', v)}
          options={[
            { value: 'replace', label: 'Replace with a new meter' },
            { value: 'decommission', label: 'Decommission' },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="retire-retiredOn"
            label="Date"
            type="date"
            max={businessToday()}
            value={values.retiredOn}
            onChange={(e) => set('retiredOn', e.target.value)}
            error={fieldError('retiredOn')}
          />
          <Input
            id="retire-finalReading"
            label="Final reading (kWh)"
            inputMode="decimal"
            value={values.finalReading}
            onChange={(e) => set('finalReading', e.target.value)}
            error={fieldError('finalReading')}
            hint="Leave empty if the meter cannot be read."
          />
          {replacing && (
            <>
              <Input
                id="retire-newSerialNumber"
                label="New serial number"
                value={values.newSerialNumber}
                onChange={(e) => set('newSerialNumber', e.target.value)}
                error={fieldError('newSerialNumber')}
              />
              <Input
                id="retire-newInitialReading"
                label="New meter's first reading (kWh)"
                inputMode="decimal"
                value={values.newInitialReading}
                onChange={(e) => set('newInitialReading', e.target.value)}
                error={fieldError('newInitialReading')}
              />
            </>
          )}
        </div>
        <Textarea
          id="retire-reason"
          label="Reason"
          rows={2}
          value={values.reason}
          onChange={(e) => set('reason', e.target.value)}
          error={fieldError('reason')}
        />
        <p className="text-label-md text-on-surface-variant">
          The readings and history are kept. Open work orders for this meter are cancelled, and no
          readings can be recorded after this date.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            {replacing ? 'Replace meter' : 'Decommission meter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
