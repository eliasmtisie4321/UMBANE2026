import { useState, type FormEvent } from 'react'
import { FormError } from '@/components/data/ListPanel'
import { Button, Modal, Textarea } from '@/components/ui'
import type { Result } from '@/types/api'

interface ReasonDialogProps {
  title: string
  description: string
  confirmLabel: string
  submit: (reason: string) => Promise<Result<unknown>>
  onClose: () => void
  onDone: () => void
}

/** Asks for a reason before closing something. Mount it to open it. */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  submit,
  onClose,
  onDone,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (reason.trim().length < 3) return setError('Give the reason.')
    if (reason.length > 500) return setError('Keep the reason under 500 characters.')
    setBusy(true)
    const result = await submit(reason.trim())
    setBusy(false)
    if (result.ok) onDone()
    else setServerError(result.error.message)
  }

  return (
    <Modal open title={title} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {serverError && <FormError>{serverError}</FormError>}
        <p className="text-body-md text-on-surface-variant">{description}</p>
        <Textarea
          id="reason"
          label="Reason"
          rows={3}
          value={reason}
          error={error}
          onChange={(e) => {
            setReason(e.target.value)
            setError(undefined)
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Go back
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
