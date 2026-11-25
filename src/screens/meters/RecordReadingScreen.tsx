import { TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorNotice, Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { DetailList } from '@/components/data/DetailList'
import { FormSection } from '@/components/data/FormSection'
import { PageHeader } from '@/components/data/PageHeader'
import { MeterPicker } from '@/components/meters/MeterPicker'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getMeter, getReadingsAround, recordReading } from '@/services/meters'
import type { AppError } from '@/types/api'
import { READING_METHODS, type MeterOption, type ReadingMethod } from '@/types/meters'
import { businessToday, checkReading, FLAG_LABEL } from '@/utils/consumption'
import { formatDate, formatKwh, formatNumber } from '@/utils/format'
import { isRealDate, parseKwh } from '@/utils/meterForm'
import { err, ok } from '@/utils/result'

type FieldName = 'meterId' | 'readingDate' | 'readingValue' | 'notes' | 'confirm'

async function loadMeterOption(id: string) {
  const result = await getMeter(id)
  if (!result.ok) return result
  const m = result.data
  if (m.retiredOn) {
    return err({
      code: 'validation' as const,
      message: `${m.serialNumber} is no longer in service, so readings cannot be recorded for it.`,
    })
  }
  return ok<MeterOption>({
    id: m.id,
    serialNumber: m.serialNumber,
    propertyName: m.propertyName,
    customerName: m.customerName,
    installedOn: m.installedOn,
  })
}

export default function RecordReadingScreen() {
  const [params] = useSearchParams()
  // Arriving from a meter page: the meter is already chosen.
  const meterId = params.get('meter') ?? ''
  const prefill = useResource(
    () => (meterId ? loadMeterOption(meterId) : Promise.resolve(ok<MeterOption | null>(null))),
    `reading-meter-${meterId}`,
  )
  const backTo = meterId ? `/electricity-meters/${meterId}` : '/electricity-meters'

  return (
    <>
      <PageHeader
        title="Record Meter Reading"
        subtitle="Consumption is calculated from the previous reading."
        back={{ to: backTo, label: meterId ? 'Meter details' : 'Electricity & Meters' }}
      />
      <ResourceBoundary state={prefill} skeletonLines={4}>
        {(meter) => <ReadingForm initialMeter={meter} cancelTo={backTo} />}
      </ResourceBoundary>
    </>
  )
}

function ReadingForm({
  initialMeter,
  cancelTo,
}: {
  initialMeter: MeterOption | null
  cancelTo: string
}) {
  const navigate = useNavigate()
  const [meter, setMeter] = useState(initialMeter)
  const [date, setDate] = useState(() => businessToday())
  const [value, setValue] = useState('')
  const [method, setMethod] = useState<ReadingMethod>('manual')
  const [isEstimate, setIsEstimate] = useState(false)
  const [notes, setNotes] = useState('')
  // The confirmation belongs to one exact entry; changing meter, date or value withdraws it.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const dateOk = isRealDate(date)
  const ready = meter !== null && dateOk
  const history = useResource(
    () => (ready ? getReadingsAround(meter.id, date) : Promise.resolve(ok([]))),
    ready ? `around-${meter.id}-${date}` : 'around-none',
  )
  // Only trust history that belongs to the meter and date on screen.
  const points = ready && history.status === 'ready' ? history.data : null
  const kwh = parseKwh(value)
  const check =
    points && meter && kwh !== null
      ? checkReading({ readingDate: date, readingValue: kwh }, points, meter)
      : null
  const previous =
    points
      ?.filter((p) => p.readingDate < date)
      .sort((a, b) => b.readingDate.localeCompare(a.readingDate))[0] ?? null

  const entryKey = `${meter?.id}|${date}|${value}`
  const confirmed = confirmedFor === entryKey
  const clear = (field: FieldName) => {
    setErrors((e) => ({ ...e, [field]: undefined, confirm: undefined }))
    setServerError(null)
  }
  const fieldError = (field: 'readingDate' | 'readingValue') =>
    errors[field] ??
    (check?.error?.field === field ? check.error.message : undefined) ??
    (serverError?.field === field ? serverError.message : undefined)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: typeof errors = {}
    if (!meter) found.meterId = 'Choose the meter.'
    if (!dateOk) found.readingDate = 'Enter the reading date.'
    if (kwh === null) found.readingValue = 'Enter kWh as digits, for example 14850.5 (no commas).'
    if (notes.length > 500) found.notes = 'Keep the notes under 500 characters.'
    if (check?.flag && !confirmed)
      found.confirm = 'Check the meter again, then confirm the reading is correct.'
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length > 0 || check?.error || !meter || kwh === null) return

    setSubmitting(true)
    const result = await recordReading({
      meterId: meter.id,
      readingDate: date,
      readingValue: kwh,
      isEstimate,
      method,
      notes: notes.trim() || null,
    })
    setSubmitting(false)
    if (!result.ok) {
      setServerError(result.error)
      return
    }
    navigate(`/electricity-meters/${meter.id}`, {
      state: {
        notice: result.data.flag
          ? `Reading recorded and flagged as ${FLAG_LABEL[result.data.flag].toLowerCase()}.`
          : 'Reading recorded.',
      },
    })
  }

  const showConsumption = check && !check.error && check.consumption !== null
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        {serverError &&
          serverError.field !== 'readingDate' &&
          serverError.field !== 'readingValue' && (
            <p
              role="alert"
              className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
            >
              {serverError.message}
            </p>
          )}
        <FormSection title="Meter">
          <div className="sm:col-span-2">
            <MeterPicker
              id="reading-meterId"
              selected={meter}
              error={errors.meterId}
              onSelect={(m) => {
                setMeter(m)
                clear('meterId')
              }}
            />
          </div>
        </FormSection>
        <FormSection title="Reading">
          <Input
            id="reading-date"
            label="Reading date"
            type="date"
            max={businessToday()}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              clear('readingDate')
            }}
            error={fieldError('readingDate')}
          />
          <Input
            id="reading-value"
            label="Current reading (kWh)"
            inputMode="decimal"
            placeholder="e.g. 14850.5"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              clear('readingValue')
            }}
            error={fieldError('readingValue')}
          />
          <Select
            id="reading-method"
            label="Reading method"
            options={READING_METHODS}
            value={method}
            onChange={(e) => setMethod(e.target.value as ReadingMethod)}
          />
          <label className="flex items-center gap-2 self-end py-2.5 text-body-md text-on-surface">
            <input
              type="checkbox"
              checked={isEstimate}
              onChange={(e) => setIsEstimate(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            This is an estimate, not read from the meter
          </label>
          <div className="sm:col-span-2">
            <Textarea
              id="reading-notes"
              label="Notes (optional)"
              rows={3}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                clear('notes')
              }}
              error={errors.notes}
            />
          </div>
        </FormSection>

        {check?.flag && (
          <div className="rounded-md bg-tertiary-container px-4 py-3 text-body-md text-on-tertiary-container">
            <p className="flex items-start gap-2 font-semibold">
              <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              {FLAG_LABEL[check.flag]} for this meter
            </p>
            <p className="mt-1">
              {formatKwh(round(check.consumption! / check.days!))} per day, compared with a usual{' '}
              {formatKwh(round(check.baseline!))} per day.
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmedFor(e.target.checked ? entryKey : null)
                  clear('confirm')
                }}
                aria-describedby={errors.confirm ? 'reading-confirm-error' : undefined}
                className="h-4 w-4 accent-primary"
              />
              I have checked the meter and this reading is correct
            </label>
            {errors.confirm && (
              <p id="reading-confirm-error" role="alert" className="mt-1 font-semibold text-error">
                {errors.confirm}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Link
            to={cancelTo}
            className="inline-flex items-center justify-center rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container"
          >
            Cancel
          </Link>
          {/* Wait for the previous readings so the unusual-value check cannot be skipped by typing
              quickly. If they fail to load, the database still validates and flags the reading. */}
          <Button
            type="submit"
            loading={submitting}
            disabled={ready && (history.status === 'loading' || history.status === 'refreshing')}
          >
            Submit Reading
          </Button>
        </div>
      </div>

      <Panel title="Reading summary" className="self-start">
        {history.status === 'error' && ready && (
          <div className="mb-3">
            <ErrorNotice message={history.error.message} onRetry={history.reload} />
          </div>
        )}
        <DetailList
          items={[
            { label: 'Meter', value: meter?.serialNumber },
            { label: 'Customer', value: meter?.customerName },
            { label: 'Property', value: meter?.propertyName },
            {
              label: 'Previous reading',
              value: previous
                ? `${formatKwh(previous.readingValue)} on ${formatDate(previous.readingDate)}`
                : points
                  ? 'None before this date'
                  : null,
            },
            {
              label: 'Consumption',
              value: showConsumption ? (
                <span className="font-semibold">
                  {formatKwh(check.consumption!)} over {formatNumber(check.days!)}{' '}
                  {check.days === 1 ? 'day' : 'days'}
                  {isEstimate ? ' (estimate)' : ''}
                </span>
              ) : null,
            },
          ]}
        />
      </Panel>
    </form>
  )
}

const round = (n: number) => Math.round(n * 10) / 10
