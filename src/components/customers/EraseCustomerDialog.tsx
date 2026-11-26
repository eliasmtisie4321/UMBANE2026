import { useState } from 'react'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { Textarea } from '@/components/ui'
import { eraseCustomer } from '@/services/settings'

/**
 * Erasing a customer's personal details on their request (POPIA). Administrators only; the
 * database refuses it while they owe money or have open tickets, and says so.
 */
export function EraseCustomerDialog({
  open,
  customerId,
  customerName,
  onClose,
  onErased,
}: {
  open: boolean
  customerId: string
  customerName: string
  onClose: () => void
  onErased: () => void
}) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (reason.trim().length < 3) {
      setReasonError('Say why, e.g. “Customer asked by email on 26 Nov”.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await eraseCustomer(customerId, reason)
    setBusy(false)
    if (!result.ok) {
      if (result.error.field === 'reason') setReasonError(result.error.message)
      else setError(result.error.message)
      return
    }
    setReason('')
    onErased()
  }

  return (
    <ConfirmDialog
      open={open}
      title={`Erase ${customerName}’s personal details?`}
      confirmLabel="Erase Personal Details"
      danger
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => {
        setError(null)
        setReasonError(undefined)
        onClose()
      }}
    >
      <div className="space-y-3 text-body-md text-on-surface">
        <p>This cannot be undone.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Removed:</strong> name, email, phone numbers, ID and registration numbers,
            address, notes, the text of their emails and support tickets, and their sign-in.
          </li>
          <li>
            <strong>Kept:</strong> invoices, payments, properties, meters and readings, which the
            law and the electricity supply need. They show as “Erased customer”.
          </li>
          <li>
            <strong>Still to do by hand:</strong> delete any photos on their tickets, and remove
            their sign-in account in Supabase (see docs/SETTINGS.md).
          </li>
        </ul>
        <Textarea
          id="erase-reason"
          label="Why (kept in the audit log)"
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setReasonError(undefined)
          }}
          error={reasonError}
        />
      </div>
    </ConfirmDialog>
  )
}
