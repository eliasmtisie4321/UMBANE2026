import { useState, type FormEvent } from 'react'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Button, Modal, Select, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { useResource } from '@/hooks/useResource'
import { assignTicket, getWorkload, setTicketStatus } from '@/services/support'
import {
  labelOf,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from '@/types/support'
import { formatNumber } from '@/utils/format'
import { needsResolution, nextStatuses, validateResolution } from '@/utils/ticketForm'

interface DialogProps {
  ticket: Ticket
  onClose: () => void
  onDone: (notice: string) => void
}

const ticketsText = (n: number) => `${formatNumber(n)} active ${n === 1 ? 'ticket' : 'tickets'}`

/** Choose who works on the ticket, seeing what each person already has. Mount it to open it. */
export function AssignDialog({ ticket, onClose, onDone }: DialogProps) {
  const workload = useResource(() => getWorkload(), 'ticket-workload')
  const [assignee, setAssignee] = useState(ticket.assignedTo ?? '')
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await assignTicket(ticket.id, assignee || null, priority)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    onDone(assignee ? 'Ticket assigned.' : 'Ticket unassigned.')
  }

  return (
    <Modal open title={`Assign ${ticket.reference}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <fieldset>
          <legend className="mb-2 text-label-md font-semibold text-on-surface">Team member</legend>
          <ResourceBoundary state={workload} skeletonLines={3}>
            {(people) => (
              <ul className="flex flex-col gap-2">
                {[
                  { id: '', name: 'Nobody yet', activeTickets: -1, urgentTickets: 0 },
                  ...people,
                ].map((p) => (
                  <li key={p.id || 'none'}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-outline-variant px-3.5 py-2.5 has-[:checked]:border-secondary has-[:checked]:bg-primary-container">
                      <input
                        type="radio"
                        name="assignee"
                        value={p.id}
                        checked={assignee === p.id}
                        onChange={() => setAssignee(p.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex-1 text-body-md font-medium text-on-surface">
                        {p.name}
                      </span>
                      {p.activeTickets >= 0 && (
                        <span className="text-label-md text-on-surface-variant">
                          {ticketsText(p.activeTickets)}
                          {p.urgentTickets > 0 && `, ${formatNumber(p.urgentTickets)} urgent`}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </ResourceBoundary>
        </fieldset>
        <Select
          id="assign-priority"
          label="Priority"
          options={TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
        />
        {!assignee && ticket.assignedTo && (
          <p className="text-body-md text-on-surface-variant">
            Without an assignee the ticket goes back to Open.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Move the ticket on. Resolving or closing asks what was done. Mount it to open it. */
export function StatusDialog({
  ticket,
  initial,
  onClose,
  onDone,
}: DialogProps & { initial?: TicketStatus }) {
  const choices = nextStatuses(ticket.status, ticket.assignedTo !== null)
  const [status, setStatus] = useState<TicketStatus>(
    initial && choices.includes(initial) ? initial : choices[0],
  )
  const [resolution, setResolution] = useState(ticket.resolution ?? '')
  const [fieldError, setFieldError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const problem = validateResolution(status, resolution)
    if (problem) return setFieldError(problem)
    setBusy(true)
    const result = await setTicketStatus(
      ticket.id,
      status,
      needsResolution(status) ? resolution : null,
    )
    setBusy(false)
    if (!result.ok) {
      if (result.error.field === 'resolution') return setFieldError(result.error.message)
      return setError(result.error.message)
    }
    onDone(`Ticket is now ${labelOf(TICKET_STATUSES, status)}.`)
  }

  return (
    <Modal open title={`Update ${ticket.reference}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormError>{error}</FormError>}
        <RadioGroup
          legend="New status"
          value={status}
          options={choices.map((s) => ({ value: s, label: labelOf(TICKET_STATUSES, s) }))}
          onChange={(s) => {
            setStatus(s)
            setFieldError(undefined)
          }}
        />
        {!ticket.assignedTo && (
          <p className="text-body-md text-on-surface-variant">
            Assign the ticket to start work on it.
          </p>
        )}
        {needsResolution(status) && (
          <Textarea
            id="ticket-resolution"
            label={status === 'closed' ? 'Resolution or reason for closing' : 'Resolution'}
            hint="The customer can see this."
            rows={4}
            value={resolution}
            error={fieldError}
            onChange={(e) => {
              setResolution(e.target.value)
              setFieldError(undefined)
            }}
          />
        )}
        {status === 'closed' && (
          <p className="text-body-md text-on-surface-variant">
            A closed ticket is final: nobody can reply or change it.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
