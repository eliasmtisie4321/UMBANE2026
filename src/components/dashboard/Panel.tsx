import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import type { Resource } from '@/hooks/useResource'

interface PanelProps {
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function Panel({ title, subtitle, action, className, children }: PanelProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'rounded-lg border border-outline-variant bg-surface p-5 shadow-card',
        className,
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title-md font-semibold text-on-surface">{title}</h2>
          {subtitle && <p className="text-label-md text-on-surface-variant">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
    >
      <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="px-3 py-1.5">
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

export function EmptyNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-surface-container-low px-4 py-6 text-center text-body-md text-on-surface-variant">
      {children}
    </p>
  )
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex animate-pulse flex-col gap-3">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-surface-container-high"
          style={{ width: `${90 - i * 18}%` }}
        />
      ))}
    </div>
  )
}

interface BoundaryProps<T> {
  state: Resource<T> & { reload: () => void }
  /** Return true when the loaded data has nothing to show. */
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  skeletonLines?: number
  children: (data: T) => ReactNode
}

/** Loading, error, empty and content states for one panel. While refreshing, content stays, dimmed. */
export function ResourceBoundary<T>({
  state,
  isEmpty,
  empty,
  skeletonLines,
  children,
}: BoundaryProps<T>) {
  if (state.status === 'loading') return <Skeleton lines={skeletonLines} />
  if (state.status === 'error' && state.data === null) {
    return <ErrorNotice message={state.error.message} onRetry={state.reload} />
  }
  const data = state.data as T
  if (isEmpty?.(data)) return <EmptyNotice>{empty}</EmptyNotice>
  return (
    <div
      className={cn('transition-opacity', state.status === 'refreshing' && 'opacity-60')}
      aria-busy={state.status === 'refreshing'}
    >
      {state.status === 'error' && (
        <div className="mb-3">
          <ErrorNotice message={state.error.message} onRetry={state.reload} />
        </div>
      )}
      {children(data)}
    </div>
  )
}
