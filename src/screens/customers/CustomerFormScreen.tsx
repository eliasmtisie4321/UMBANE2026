import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { PageHeader } from '@/components/data/PageHeader'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { useResource } from '@/hooks/useResource'
import { createCustomer, getCustomer, updateCustomer } from '@/services/customers'
import type { AppError } from '@/types/api'
import {
  changedFieldLabels,
  customerToForm,
  emptyCustomerForm,
  toCustomerInput,
  type CustomerFormValues,
} from '@/utils/customerForm'
import { CustomerForm } from './CustomerForm'

export function NewCustomerScreen() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  async function save(values: CustomerFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await createCustomer(toCustomerInput(values))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/customers/${result.data.id}`, { state: { notice: 'Customer created.' } })
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <PageHeader
        title="Add New Customer"
        subtitle="Create a customer record. You can add properties to it afterwards."
        back={{ to: '/customers', label: 'Customers' }}
      />
      <CustomerForm
        initial={emptyCustomerForm}
        mode="create"
        submitting={submitting}
        serverError={error}
        cancelTo="/customers"
        onSubmit={save}
      />
    </>
  )
}

export function EditCustomerScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(() => getCustomer(id), `customer-${id}`)

  const [pending, setPending] = useState<CustomerFormValues | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  const original = state.data ? customerToForm(state.data) : null
  const changes = pending && original ? changedFieldLabels(original, pending) : []

  function review(values: CustomerFormValues) {
    if (!original) return
    setError(null)
    if (changedFieldLabels(original, values).length === 0) {
      navigate(`/customers/${id}`, { state: { notice: 'No changes to save.' } })
      return
    }
    setPending(values)
  }

  async function confirm() {
    if (!pending) return
    setSubmitting(true)
    const result = await updateCustomer(id, toCustomerInput(pending))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/customers/${id}`, { state: { notice: 'Customer updated.' } })
    } else {
      // Duplicates name a field: close the dialog so the message shows where it applies.
      setError(result.error)
      if (result.error.field) setPending(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Edit Customer"
        subtitle={state.data?.name}
        back={{ to: `/customers/${id}`, label: 'Customer profile' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(customer) => (
          <CustomerForm
            // Remount if a different customer is loaded.
            key={customer.id}
            initial={customerToForm(customer)}
            mode="edit"
            submitting={false}
            serverError={pending ? null : error}
            cancelTo={`/customers/${id}`}
            onSubmit={review}
          />
        )}
      </ResourceBoundary>

      <ConfirmDialog
        open={pending !== null}
        title="Confirm customer changes"
        confirmLabel="Confirm & Save"
        cancelLabel="Keep Editing"
        busy={submitting}
        error={pending ? error?.message : null}
        onConfirm={confirm}
        onCancel={() => {
          setPending(null)
          setError(null)
        }}
      >
        <p>These details will change:</p>
        <ul className="mt-2 list-disc pl-5 text-on-surface">
          {changes.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  )
}
