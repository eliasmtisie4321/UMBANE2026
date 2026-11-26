import { Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ActivityPanel, FilesPanel } from '@/components/data/FilesPanel'
import { FormError } from '@/components/data/ListPanel'
import { Button, Textarea } from '@/components/ui'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { cn } from '@/components/ui/cn'
import { useResource } from '@/hooks/useResource'
import {
  attachmentUrls,
  listAttachments,
  listEvents,
  listMessages,
  postMessage,
  uploadAttachment,
} from '@/services/support'
import { formatDateTime, formatNumber } from '@/utils/format'
import { TICKET_FILES } from '@/utils/files'
import { describeEvent, validateMessage } from '@/utils/ticketForm'

interface ConversationProps {
  ticketId: string
  isStaff: boolean
  canReply: boolean
  version: number
  onSent: (notice: string) => void
}

/** Replies the customer sees, and (for staff) internal notes the customer never sees. */
export function ConversationPanel({
  ticketId,
  isStaff,
  canReply,
  version,
  onSent,
}: ConversationProps) {
  const messages = useResource(() => listMessages(ticketId), `messages-${ticketId}-${version}`)
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<'reply' | 'internal'>('reply')
  const [fieldError, setFieldError] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const internal = isStaff && mode === 'internal'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const problem = validateMessage(body)
    if (problem) return setFieldError(problem)
    setBusy(true)
    const result = await postMessage(ticketId, body, internal)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setBody('')
    onSent(internal ? 'Internal note added.' : 'Reply sent.')
  }

  const count = messages.data?.length ?? 0
  return (
    <Panel
      title="Conversation"
      subtitle={`${formatNumber(count)} ${count === 1 ? 'message' : 'messages'}`}
    >
      <ResourceBoundary
        state={messages}
        isEmpty={(rows) => rows.length === 0}
        empty="No messages yet."
      >
        {(rows) => (
          <ol className="flex flex-col gap-3" aria-label="Messages">
            {rows.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'rounded-lg border px-4 py-3',
                  m.isInternal
                    ? 'border-tertiary bg-tertiary-container/40'
                    : m.fromStaff
                      ? 'border-outline-variant bg-surface-container-low'
                      : 'border-secondary/40 bg-primary-container/30',
                )}
              >
                <p className="flex flex-wrap items-center gap-x-2 text-label-md text-on-surface-variant">
                  <span className="font-semibold text-on-surface">
                    {m.authorName ?? 'Someone'}
                    {isStaff && !m.fromStaff && ' (customer)'}
                    {!isStaff && m.fromStaff && ' (support team)'}
                  </span>
                  <span>{formatDateTime(m.createdAt)}</span>
                  {m.isInternal && (
                    <span className="inline-flex items-center gap-1 font-semibold text-on-tertiary-container">
                      <Lock size={14} aria-hidden="true" /> Internal note
                    </span>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-body-md text-on-surface">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </ResourceBoundary>

      {canReply ? (
        <form
          onSubmit={onSubmit}
          noValidate
          className="mt-4 flex flex-col gap-3 border-t border-outline-variant pt-4"
        >
          {error && <FormError>{error}</FormError>}
          {isStaff && (
            <RadioGroup
              legend="Send as"
              value={mode}
              options={[
                { value: 'reply', label: 'Reply to customer' },
                { value: 'internal', label: 'Internal note' },
              ]}
              onChange={setMode}
            />
          )}
          <Textarea
            id="ticket-message"
            label={internal ? 'Internal note' : isStaff ? 'Reply' : 'Your message'}
            hint={
              internal
                ? 'Only the team can see internal notes.'
                : isStaff
                  ? 'The customer will see this.'
                  : undefined
            }
            rows={4}
            value={body}
            error={fieldError}
            onChange={(e) => {
              setBody(e.target.value)
              setFieldError(undefined)
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              {internal ? 'Add Note' : 'Send Reply'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 border-t border-outline-variant pt-4 text-body-md text-on-surface-variant">
          This ticket is closed. To raise something new, open another ticket.
        </p>
      )}
    </Panel>
  )
}

interface AttachmentsProps {
  ticket: { id: string; businessId: string }
  canUpload: boolean
  version: number
  onUploaded: (notice: string) => void
}

export function AttachmentsPanel({ ticket, canUpload, version, onUploaded }: AttachmentsProps) {
  return (
    <FilesPanel
      source={{
        key: `ticket-${ticket.id}`,
        list: () => listAttachments(ticket.id),
        urls: (paths) => attachmentUrls(paths),
        upload: (file) => uploadAttachment(ticket, file),
        rules: TICKET_FILES,
      }}
      canUpload={canUpload}
      version={version}
      onUploaded={onUploaded}
    />
  )
}

export function HistoryPanel({ ticketId, version }: { ticketId: string; version: number }) {
  return (
    <ActivityPanel
      load={() => listEvents(ticketId)}
      loadKey={`events-${ticketId}-${version}`}
      describe={describeEvent}
      label="Ticket activity"
    />
  )
}
