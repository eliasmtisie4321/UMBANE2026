import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { useResource } from '@/hooks/useResource'
import { getLead } from '@/services/leads'
import { getOrder, saveOrder } from '@/services/orders'
import { getCustomerOption } from '@/services/properties'
import type { AppError, Result } from '@/types/api'
import type { CustomerOption } from '@/types/properties'
import { err, ok } from '@/utils/result'
import { emptyOrderForm, orderToForm, toOrderInput, type OrderFormValues } from '@/utils/salesForm'
import { OrderForm } from './OrderForm'

interface Prefill {
  customer: CustomerOption | null
  lead: { id: string; label: string; assignedTo: string | null } | null
}

/** From a lead, its customer is fixed; from a customer page, the customer is chosen already. */
async function loadPrefill(leadId: string, customerId: string): Promise<Result<Prefill>> {
  let lead: Prefill['lead'] = null
  let target = customerId
  if (leadId) {
    const result = await getLead(leadId)
    if (!result.ok) return result
    if (!result.data.customerId) {
      return err({
        code: 'validation',
        message: 'Convert this lead to a customer before creating an order for it.',
      })
    }
    target = result.data.customerId
    lead = { id: leadId, label: result.data.reference, assignedTo: result.data.assignedTo }
  }
  if (!target) return ok({ customer: null, lead })
  const customer = await getCustomerOption(target)
  return customer.ok ? ok({ customer: customer.data, lead }) : customer
}

export function NewOrderScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const leadId = params.get('lead') ?? ''
  const customerId = params.get('customer') ?? ''
  const prefill = useResource(
    () => loadPrefill(leadId, customerId),
    `order-prefill-${leadId}-${customerId}`,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const back = leadId
    ? { to: `/leads/${leadId}`, label: 'Lead details' }
    : customerId
      ? { to: `/customers/${customerId}`, label: 'Customer profile' }
      : { to: '/sales-orders', label: 'Sales & Orders' }

  async function save(values: OrderFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await saveOrder(null, toOrderInput(values))
    setSubmitting(false)
    if (result.ok) {
      navigate(`/sales-orders/${result.data.id}`, { state: { notice: 'Order saved as pending.' } })
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <PageHeader title="Create Order" subtitle="Saved as pending until confirmed." back={back} />
      <ResourceBoundary state={prefill} skeletonLines={6}>
        {({ customer, lead }) => (
          <OrderForm
            initial={{
              ...emptyOrderForm(),
              customerId: customer?.id ?? '',
              leadId: lead?.id ?? null,
              assignedTo: lead?.assignedTo ?? '',
            }}
            initialCustomer={customer}
            leadLabel={lead && `from lead ${lead.label}`}
            mode="create"
            submitting={submitting}
            serverError={error}
            cancelTo={back.to}
            onSubmit={save}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

export function EditOrderScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const state = useResource(() => getOrder(id), `order-${id}`)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<AppError | null>(null)

  async function save(values: OrderFormValues) {
    setSubmitting(true)
    setError(null)
    const result = await saveOrder(id, toOrderInput(values))
    setSubmitting(false)
    if (result.ok) navigate(`/sales-orders/${id}`, { state: { notice: 'Order updated.' } })
    else setError(result.error)
  }

  return (
    <>
      <PageHeader
        title="Edit Order"
        subtitle={state.data?.reference}
        back={{ to: `/sales-orders/${id}`, label: 'Order details' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(order) =>
          order.status === 'pending' ? (
            <OrderForm
              key={order.id}
              initial={orderToForm(order)}
              initialCustomer={{
                id: order.customerId,
                name: order.customerName,
                companyName: null,
                email: null,
              }}
              assignedName={order.assignedName}
              leadLabel={order.leadId ? 'from a lead' : null}
              mode="edit"
              submitting={submitting}
              serverError={error}
              cancelTo={`/sales-orders/${id}`}
              onSubmit={save}
            />
          ) : (
            <FormError>Only a pending order can be edited. This one is {order.status}.</FormError>
          )
        }
      </ResourceBoundary>
    </>
  )
}
