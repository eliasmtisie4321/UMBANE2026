import { useState, type FormEvent } from 'react'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Button, Modal } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { convertLead, getLeadMatches } from '@/services/leads'
import type { Lead, LeadMatch } from '@/types/sales'
import { formatPhone } from '@/utils/phone'

interface ConvertLeadDialogProps {
  lead: Lead
  onClose: () => void
  onConverted: (customerId: string, created: boolean) => void
}

const REASON: Record<LeadMatch['matchedOn'], string> = {
  email: 'same email address',
  phone: 'same phone number',
  company: 'same company name',
}

/** Turns a lead into a customer, offering existing customers first. Mount it to open it. */
export function ConvertLeadDialog({ lead, onClose, onConverted }: ConvertLeadDialogProps) {
  const matches = useResource(() => getLeadMatches(lead.id), `matches-${lead.id}`)
  return (
    <Modal open title="Convert to customer" onClose={onClose}>
      <ResourceBoundary state={matches}>
        {(rows) => (
          <ConvertForm lead={lead} matches={rows} onClose={onClose} onConverted={onConverted} />
        )}
      </ResourceBoundary>
    </Modal>
  )
}

const NEW = 'new'

function ConvertForm({
  lead,
  matches,
  onClose,
  onConverted,
}: ConvertLeadDialogProps & { matches: LeadMatch[] }) {
  // A customer with this email already exists, so a second one is not possible.
  const emailMatch = matches.find((m) => m.matchedOn === 'email')
  const [choice, setChoice] = useState<string>(emailMatch?.id ?? (matches.length === 0 ? NEW : ''))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!choice) return setError('Choose an existing customer, or create a new one.')
    setError(null)
    setBusy(true)
    const create = choice === NEW
    const result = await convertLead(lead.id, create ? null : choice, create && matches.length > 0)
    setBusy(false)
    if (result.ok) onConverted(result.data.customerId, create)
    else setError(result.error.message)
  }

  const option = (value: string, title: string, detail: string) => (
    <label
      key={value}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-outline-variant px-3.5 py-2.5 has-[:checked]:border-secondary has-[:checked]:bg-primary-container"
    >
      <input
        type="radio"
        name="convert-choice"
        value={value}
        checked={choice === value}
        onChange={() => {
          setChoice(value)
          setError(null)
        }}
        className="mt-1 h-4 w-4 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-body-md font-medium text-on-surface">{title}</span>
        <span className="block text-label-md text-on-surface-variant">{detail}</span>
      </span>
    </label>
  )

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <FormError>{error}</FormError>}
      {matches.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">
          A new customer will be created from {lead.companyName ?? lead.name}’s details. You can
          complete the customer’s address and other details afterwards.
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body-md text-on-surface">
            {emailMatch
              ? 'A customer with this email address already exists. Link the lead to it, so the customer is not duplicated.'
              : 'This lead may already be a customer.'}
          </legend>
          {matches.map((m) =>
            option(
              m.id,
              `Link to ${m.companyName ? `${m.name} (${m.companyName})` : m.name}`,
              [REASON[m.matchedOn], m.email, m.phone && formatPhone(m.phone)]
                .filter(Boolean)
                .join(' · '),
            ),
          )}
          {!emailMatch &&
            option(NEW, 'Create a new customer', 'None of these is the same customer')}
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Convert lead
        </Button>
      </div>
    </form>
  )
}
