import type { HTMLAttributes } from 'react'
import { cn } from './cn'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-container text-on-surface-variant',
  info: 'bg-secondary-container text-on-secondary-container',
  success: 'bg-green-100 text-success',
  warning: 'bg-tertiary-container text-on-tertiary-container',
  error: 'bg-error-container text-on-error-container',
}

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-label-sm font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    />
  )
}
