import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { PageHeader } from '@/components/data/PageHeader'
import { useResource } from '@/hooks/useResource'
import { getMeter, getPropertyOption, registerMeter, updateMeter } from '@/services/meters'
import type { AppError } from '@/types/api'
import {
  emptyMeterForm,
  meterToForm,
  toMeterUpdate,
  toNewMeter,
  type MeterFormValues,
} from '@/utils/meterForm'
import { ok } from '@/utils/result'
import { MeterForm } from './MeterForm'

export function NewMeterScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Arriving from a property page: the property is already chosen.
  const propertyId = params.get('property') ?? ''
  const property = useResource(
    () => (propertyId ? getPropertyOption(propertyId) : Promise.resolve(ok(null))),
    `meter-property-${propertyId}`,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const cancelTo = propertyId ? `/properties/${propertyId}` : '/electricity-meters'

  async function save(values: MeterFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await registerMeter(toNewMeter(values))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/electricity-meters/${result.data.id}`, { state: { notice: 'Meter registered.' } })
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <PageHeader
        title="Add Electricity Meter"
        subtitle="Register a meter, link it to a property and record its first reading."
        back={{ to: cancelTo, label: propertyId ? 'Property details' : 'Electricity & Meters' }}
      />
      <ResourceBoundary state={property} skeletonLines={4}>
        {(prefill) => (
          <MeterForm
            initial={{ ...emptyMeterForm, propertyId: prefill?.id ?? '' }}
            initialProperty={prefill}
            mode="create"
            submitting={submitting}
            serverError={error}
            cancelTo={cancelTo}
            onSubmit={save}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

export function EditMeterScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(() => getMeter(id), `meter-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const retired = state.data !== null && state.data.retiredOn !== null

  async function save(values: MeterFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await updateMeter(id, toMeterUpdate(values, retired))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/electricity-meters/${id}`, { state: { notice: 'Meter updated.' } })
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <PageHeader
        title="Edit Meter"
        subtitle={state.data?.serialNumber}
        back={{ to: `/electricity-meters/${id}`, label: 'Meter details' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(meter) => (
          <MeterForm
            key={meter.id}
            initial={meterToForm(meter)}
            initialProperty={{
              id: meter.propertyId,
              name: meter.propertyName,
              detail: [meter.propertyReference, meter.propertyAddress, meter.customerName]
                .filter(Boolean)
                .join(' · '),
            }}
            mode="edit"
            retired={retired}
            submitting={submitting}
            serverError={error}
            cancelTo={`/electricity-meters/${id}`}
            onSubmit={save}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
