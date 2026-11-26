import { useState, type FormEvent } from 'react'
import { FormError } from '@/components/data/ListPanel'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { recordPayment } from '@/services/invoices'
import type { AppError } from '@/types/api'
import { PAYMENT_METHOD_CODES, type Invoice, type PaymentMethodCode } from '@/types/invoices'
import { businessToday } from '@/utils/consumption'
import { formatRand } from '@/utils/format'
import {
  paymentFormFor,
  toPaymentInput,
  validatePaymentForm,
  type PaymentFormErrors,
  type PaymentFormValues,
} from '@/utils/invoiceForm'

interface PaymentDialogProps {
  invoice: Invoice
  onClose: () => void
  onSaved: () => void
}

/** Record money received against an invoice. Mount it to open it. */
export function PaymentDialog({ invoice, onClose, onSaved }: PaymentDialogProps) {
  const [values, setValues] = useState<PaymentFormValues>(() => paymentFormFor(invoice.balance))
  const [errors, setErrors] = useState<PaymentFormErrors>({})
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof PaymentFormValues>(key: K, value: PaymentFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }
  const fieldError = (k: keyof PaymentFormValues) =>
    errors[k] ?? (serverError?.field === k ? serverError.message : undefined)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validatePaymentForm(values, {
      balance: invoice.balance,
      issueDate: invoice.issueDate,
    })
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    const result = await recordPayment(toPaymentInput(invoice.id, values))
    setSaving(false)
    if (result.ok) onSaved()
    else setServerError(result.error)
  }

  return (
    <Modal open title={`Record payment for ${invoice.reference}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {serverError && !serverError.field && <FormError>{serverError.message}</FormError>}
        <p className="text-body-md text-on-surface-variant">
          Balance due: <strong>{formatRand(invoice.balance, { cents: true })}</strong>
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="pay-amount"
            label="Amount received (R)"
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => set('amount', e.target.value)}
            error={fieldError('amount')}
          />
          <Input
            id="pay-paidOn"
            label="Date received"
            type="date"
            max={businessToday()}
            min={invoice.issueDate ?? undefined}
            value={values.paidOn}
            onChange={(e) => set('paidOn', e.target.value)}
            error={fieldError('paidOn')}
          />
          <Select
            id="pay-method"
            label="Method"
            options={PAYMENT_METHOD_CODES}
            value={values.method}
            onChange={(e) => set('method', e.target.value as PaymentMethodCode)}
          />
          <Input
            id="pay-reference"
            label="Reference (optional)"
            placeholder="e.g. bank reference"
            value={values.reference}
            onChange={(e) => set('reference', e.target.value)}
            error={fieldError('reference')}
          />
        </div>
        <Textarea
          id="pay-notes"
          label="Notes (optional)"
          rows={2}
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          error={fieldError('notes')}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  )
}
