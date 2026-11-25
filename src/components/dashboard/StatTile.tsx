import type { LucideIcon } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import type { Resource } from '@/hooks/useResource'

export interface TileContent {
  value: string
  /** Secondary line under the value. Plain text, so state is never carried by colour alone. */
  detail?: string
  tone?: 'neutral' | 'warning' | 'error'
}

interface StatTileProps<T> {
  label: string
  icon: LucideIcon
  state: Resource<T> & { reload: () => void }
  map: (data: T) => TileContent
}

const toneClass = {
  neutral: 'text-on-surface-variant',
  warning: 'text-on-tertiary-container',
  error: 'text-error',
}

/** One headline number. Loads, fails and refreshes independently of the rest of the dashboard. */
export function StatTile<T>({ label, icon: Icon, state, map }: StatTileProps<T>) {
  const content = state.data !== null ? map(state.data) : null
  const failed = state.status === 'error' && content === null
  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-label-md font-medium text-on-surface-variant">{label}</h3>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary-container text-primary">
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>
      {state.status === 'loading' && (
        <div role="status" aria-label={`Loading ${label}`} className="animate-pulse space-y-2">
          <div className="h-8 w-24 rounded bg-surface-container-high" />
          <div className="h-3 w-32 rounded bg-surface-container-high" />
        </div>
      )}
      {failed && state.status === 'error' && (
        <div role="alert" className="text-label-md text-error">
          <p>{state.error.message}</p>
          <button type="button" onClick={state.reload} className="mt-1 font-semibold underline">
            Try again
          </button>
        </div>
      )}
      {content && (
        <div className={cn('transition-opacity', state.status === 'refreshing' && 'opacity-60')}>
          <p className="text-headline-md font-bold text-on-surface">{content.value}</p>
          {content.detail && (
            <p className={cn('mt-1 text-label-md', toneClass[content.tone ?? 'neutral'])}>
              {content.detail}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
