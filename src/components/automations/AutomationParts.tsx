import { AlertTriangle, CheckCircle2, Circle, MinusCircle, XCircle } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import type { ActionOutcome, RunStatus } from '@/types/automations'
import { OUTCOME_LABEL, RUN_STATUS_LABEL } from '@/types/automations'

/** On or off, in words with an icon, never colour alone. */
export function OnOffBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-label-md font-semibold',
        enabled
          ? 'bg-primary-container text-primary'
          : 'bg-surface-container-high text-on-surface-variant',
      )}
    >
      {enabled ? (
        <CheckCircle2 size={14} aria-hidden="true" />
      ) : (
        <Circle size={14} aria-hidden="true" />
      )}
      {enabled ? 'On' : 'Off'}
    </span>
  )
}

const STATUS_STYLE: Record<RunStatus, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success' },
  nothing_to_do: { icon: MinusCircle, className: 'text-on-surface-variant' },
  partial: { icon: AlertTriangle, className: 'text-on-tertiary-container' },
  failed: { icon: XCircle, className: 'text-error' },
}

export function RunStatusText({ status }: { status: RunStatus | null }) {
  if (!status) return <span className="text-on-surface-variant">Not run yet</span>
  const { icon: Icon, className } = STATUS_STYLE[status]
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', className)}>
      <Icon size={14} aria-hidden="true" />
      {RUN_STATUS_LABEL[status]}
    </span>
  )
}

const OUTCOME_STYLE: Record<ActionOutcome, string> = {
  pending: 'text-on-surface-variant',
  notified: 'text-success',
  emailed: 'text-success',
  skipped: 'text-on-surface-variant',
  failed: 'text-error',
}

export function OutcomeText({ outcome }: { outcome: ActionOutcome }) {
  return <span className={cn('font-medium', OUTCOME_STYLE[outcome])}>{OUTCOME_LABEL[outcome]}</span>
}
