import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { PageHeader } from '@/components/data/PageHeader'
import { useResource } from '@/hooks/useResource'
import {
  createProperty,
  getCustomerOption,
  getProperty,
  updateProperty,
} from '@/services/properties'
import type { AppError } from '@/types/api'
import {
  emptyPropertyForm,
  propertyToForm,
  toPropertyInput,
  type PropertyFormValues,
} from '@/utils/propertyForm'
import { ok } from '@/utils/result'
import { PropertyForm } from './PropertyForm'

export function NewPropertyScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Arriving from a customer profile: the owner is already chosen.
  const customerId = params.get('customer') ?? ''
  const owner = useResource(
    () => (customerId ? getCustomerOption(customerId) : Promise.resolve(ok(null))),
    `owner-${customerId}`,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  async function save(values: PropertyFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await createProperty(toPropertyInput(values))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/properties/${result.data.id}`, { state: { notice: 'Property registered.' } })
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <PageHeader
        title="Register Property"
        subtitle="Add a property and link it to its owner."
        back={{
          to: customerId ? `/customers/${customerId}` : '/properties',
          label: customerId ? 'Customer profile' : 'Properties',
        }}
      />
      <ResourceBoundary state={owner} skeletonLines={4}>
        {(prefill) => (
          <PropertyForm
            initial={{ ...emptyPropertyForm, customerId: prefill?.id ?? '' }}
            initialOwner={prefill}
            mode="create"
            submitting={submitting}
            serverError={error}
            cancelTo={customerId ? `/customers/${customerId}` : '/properties'}
            onSubmit={save}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

export function EditPropertyScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(() => getProperty(id), `property-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  async function save(values: PropertyFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await updateProperty(id, toPropertyInput(values))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/properties/${id}`, { state: { notice: 'Property updated.' } })
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <PageHeader
        title="Edit Property"
        subtitle={state.data ? (state.data.name ?? state.data.address) : undefined}
        back={{ to: `/properties/${id}`, label: 'Property details' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(property) => (
          <PropertyForm
            key={property.id}
            initial={propertyToForm(property)}
            initialOwner={{
              id: property.customerId,
              name: property.ownerName ?? 'Unknown customer',
              companyName: null,
              email: null,
            }}
            mode="edit"
            submitting={submitting}
            serverError={error}
            cancelTo={`/properties/${id}`}
            onSubmit={save}
          />
        )}
      </ResourceBoundary>
    </>
  )
}
