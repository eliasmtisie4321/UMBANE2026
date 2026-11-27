import { useState } from 'react'
import { Badge, Button } from '@/components/ui'
import { invitationAction } from '@/services/team'
import { ROLE_LABEL } from '@/types/auth'
import type { Invitation, InvitationState } from '@/types/team'
import { copyText } from '@/utils/browser'
import { formatDate } from '@/utils/format'

const STATE: Record<
  InvitationState,
  { tone: 'neutral' | 'info' | 'success' | 'warning' | 'error'; label: string }
> = {
  pending: { tone: 'neutral', label: 'Not sent' },
  sent: { tone: 'info', label: 'Sent' },
  failed: { tone: 'error', label: 'Failed' },
  accepted: { tone: 'success', label: 'Accepted' },
  expired: { tone: 'warning', label: 'Expired' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
}

export function InvitationStateBadge({ state }: { state: InvitationState }) {
  return <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>
}

/**
 * One invitation on the Team page: where it stands and, for administrators, sending it again
 * (it is open for another week), copying its link to share another way, or cancelling it.
 */
export function InvitationRow({
  invitation: i,
  onChanged,
  onCancel,
}: {
  invitation: Invitation
  onChanged: (notice: string) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState<'send' | 'link' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  async function send() {
    setBusy('send')
    setError(null)
    const r = await invitationAction(i.state === 'pending' ? 'send' : 'resend', i.id)
    setBusy(null)
    if (!r.ok) return setError(r.error.message)
    if (r.data.state === 'sent')
      onChanged(`Invitation sent to ${i.email}${r.data.via ? ` through ${r.data.via}` : ''}.`)
    else if (r.data.state === 'failed') {
      setError(`Not sent: ${r.data.error} You can copy the link and share it another way.`)
      onChanged(`The invitation for ${i.email} could not be sent.`)
    }
  }

  async function copy() {
    setBusy('link')
    setError(null)
    const r = await invitationAction('link', i.id)
    setBusy(null)
    if (!r.ok) return setError(r.error.message)
    if (r.data.state !== 'link') return
    if (await copyText(r.data.link))
      onChanged(`Invitation link for ${i.email} copied. Share it only with them.`)
    else setLink(r.data.link)
  }

  const details = [
    i.email,
    ROLE_LABEL[i.role],
    i.sentAt ? `sent ${formatDate(i.sentAt)}` : `added ${formatDate(i.createdAt)}`,
    i.expiresAt && i.state !== 'expired' ? `open until ${formatDate(i.expiresAt)}` : null,
  ].filter(Boolean)

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-body-md font-medium text-on-surface">
            {i.fullName} <InvitationStateBadge state={i.state} />
          </p>
          <p className="truncate text-label-md text-on-surface-variant">{details.join(' · ')}</p>
          {i.sentVia && i.state === 'sent' && (
            <p className="text-label-sm text-on-surface-variant">Through {i.sentVia}</p>
          )}
          {i.state === 'failed' && i.lastError && (
            <p className="text-label-sm text-error">{i.lastError}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={busy === 'send'}
          disabled={busy !== null}
          onClick={() => void send()}
          aria-label={`${i.state === 'pending' ? 'Send' : 'Resend'} invitation to ${i.email}`}
        >
          {i.state === 'pending' ? 'Send' : 'Resend'}
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'link'}
          disabled={busy !== null}
          onClick={() => void copy()}
          aria-label={`Copy invitation link for ${i.email}`}
        >
          Copy Link
        </Button>
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={onCancel}
          aria-label={`Cancel invitation for ${i.email}`}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-label-sm text-error">
          {error}
        </p>
      )}
      {link && (
        <label className="flex flex-col gap-1 text-label-md text-on-surface">
          Invitation link (copy it and share it only with {i.fullName})
          <input
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            className="rounded-md border border-outline-variant px-2 py-1 font-mono text-label-sm"
          />
        </label>
      )}
    </li>
  )
}
