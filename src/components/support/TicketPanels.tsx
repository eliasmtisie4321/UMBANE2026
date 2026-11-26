import { FileText, Lock, Paperclip, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
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
import type { TicketAttachment } from '@/types/support'
import { formatDateTime, formatNumber } from '@/utils/format'
import {
  checkFiles,
  describeEvent,
  FILE_ACCEPT,
  FILE_HINT,
  FILES_PER_TICKET,
  formatBytes,
  isImage,
  validateMessage,
} from '@/utils/ticketForm'

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
  const files = useResource(async () => {
    const list = await listAttachments(ticket.id)
    if (!list.ok) return list
    const urls = await attachmentUrls(list.data.map((f) => f.storagePath))
    return { ok: true as const, data: { list: list.data, urls: urls.ok ? urls.data : {} } }
  }, `attachments-${ticket.id}-${version}`)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])

  async function onPick(picked: File[]) {
    const { accepted, problems: refused } = checkFiles(picked, files.data?.list.length ?? 0)
    const failed = [...refused]
    setBusy(true)
    let added = 0
    for (const f of accepted) {
      const r = await uploadAttachment(ticket, f)
      if (r.ok) added += 1
      else failed.push(r.error.message)
    }
    setBusy(false)
    setProblems(failed)
    if (input.current) input.current.value = ''
    if (added > 0) onUploaded(`${formatNumber(added)} ${added === 1 ? 'file' : 'files'} attached.`)
  }

  const count = files.data?.list.length ?? 0
  return (
    <Panel
      title="Photos and documents"
      subtitle={`${formatNumber(count)} of ${FILES_PER_TICKET} files`}
      action={
        canUpload && count < FILES_PER_TICKET ? (
          <>
            <input
              ref={input}
              id="ticket-files"
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="sr-only"
              aria-label="Attach files"
              onChange={(e) => void onPick(Array.from(e.target.files ?? []))}
            />
            <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Attach Files
            </Button>
          </>
        ) : undefined
      }
    >
      {problems.length > 0 && (
        <div className="mb-3">
          <FormError>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </FormError>
        </div>
      )}
      <ResourceBoundary
        state={files}
        isEmpty={(d) => d.list.length === 0}
        empty={canUpload ? FILE_HINT : 'No files are attached.'}
      >
        {({ list, urls }) => <AttachmentList files={list} urls={urls} />}
      </ResourceBoundary>
    </Panel>
  )
}

function AttachmentList({
  files,
  urls,
}: {
  files: TicketAttachment[]
  urls: Record<string, string>
}) {
  const images = files.filter((f) => isImage(f.contentType))
  const documents = files.filter((f) => !isImage(f.contentType))
  const meta = (f: TicketAttachment) =>
    [formatBytes(f.sizeBytes), f.uploaderName, formatDateTime(f.createdAt)]
      .filter(Boolean)
      .join(' · ')
  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos">
          {images.map((f) => (
            <li key={f.id} className="overflow-hidden rounded-lg border border-outline-variant">
              {urls[f.storagePath] ? (
                <a href={urls[f.storagePath]} target="_blank" rel="noopener noreferrer">
                  <img
                    src={urls[f.storagePath]}
                    alt={f.fileName}
                    loading="lazy"
                    className="aspect-[4/3] w-full bg-surface-container object-cover"
                  />
                </a>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-surface-container text-label-md text-on-surface-variant">
                  Preview unavailable
                </div>
              )}
              <p className="truncate px-2 pt-1.5 text-label-md font-medium text-on-surface">
                {f.fileName}
              </p>
              <p className="truncate px-2 pb-1.5 text-label-sm text-on-surface-variant">
                {meta(f)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {documents.length > 0 && (
        <ul className="divide-y divide-outline-variant" aria-label="Documents">
          {documents.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <FileText size={20} className="shrink-0 text-on-surface-variant" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {urls[f.storagePath] ? (
                  <a
                    href={urls[f.storagePath]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-body-md font-medium text-secondary hover:underline"
                  >
                    {f.fileName}
                  </a>
                ) : (
                  <p className="truncate text-body-md font-medium">{f.fileName}</p>
                )}
                <p className="text-label-md text-on-surface-variant">{meta(f)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function HistoryPanel({ ticketId, version }: { ticketId: string; version: number }) {
  const events = useResource(() => listEvents(ticketId), `events-${ticketId}-${version}`)
  return (
    <Panel title="Activity">
      <ResourceBoundary state={events} isEmpty={(r) => r.length === 0} empty="No activity yet.">
        {(rows) => (
          <ol className="flex flex-col gap-3" aria-label="Ticket activity">
            {rows.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-secondary"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-body-md text-on-surface">
                    {e.kind === 'attachment' && (
                      <Paperclip size={14} className="mr-1 inline" aria-hidden="true" />
                    )}
                    {describeEvent(e)}
                  </p>
                  <p className="text-label-md text-on-surface-variant">
                    {[e.actorName, formatDateTime(e.createdAt)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </ResourceBoundary>
    </Panel>
  )
}
