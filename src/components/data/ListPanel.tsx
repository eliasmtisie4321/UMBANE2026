import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorNotice, Panel } from '@/components/dashboard/Panel'
import { Button } from '@/components/ui'
import type { Resource } from '@/hooks/useResource'
import type { Page } from '@/types/customers'
import { PAGE_SIZE } from '@/utils/listParams'
import { Pagination } from './Pagination'

interface ListPanelProps<T> {
  title: string
  /** Plural noun for messages, e.g. "leads". */
  noun: string
  state: Resource<Page<T>> & { reload: () => void }
  page: number
  /** True when a search or filter is narrowing the list. */
  filtered: boolean
  /** Shown when there is nothing at all. */
  empty: ReactNode
  action?: ReactNode
  onPage: (page: number) => void
  onClear: () => void
  children: (rows: T[]) => ReactNode
}

/** A paged list with its loading, error, empty and refreshing states. */
export function ListPanel<T>({
  title,
  noun,
  state,
  page,
  filtered,
  empty,
  action,
  onPage,
  onClear,
  children,
}: ListPanelProps<T>) {
  const data = state.data
  return (
    <Panel
      title={title}
      action={action}
      subtitle={
        data
          ? `${data.total.toLocaleString('en-US')} ${filtered ? 'matching ' : ''}${noun}`
          : undefined
      }
    >
      {state.status === 'loading' && (
        <div role="status" aria-label={`Loading ${noun}`} className="animate-pulse space-y-3 p-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-5 rounded bg-surface-container-high" />
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <div className="mb-3">
          <ErrorNotice message={state.error.message} onRetry={state.reload} />
        </div>
      )}
      {data && data.rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-md bg-surface-container-low px-4 py-10 text-center text-body-md text-on-surface-variant">
          {data.total > 0 ? (
            <>
              <p>There are no {noun} on this page.</p>
              <Button variant="secondary" onClick={() => onPage(1)}>
                Go to the first page
              </Button>
            </>
          ) : filtered ? (
            <>
              <p>No {noun} match your search or filters.</p>
              <Button variant="secondary" onClick={onClear}>
                Clear search and filters
              </Button>
            </>
          ) : (
            empty
          )}
        </div>
      )}
      {data && data.rows.length > 0 && (
        <div
          className={
            state.status === 'refreshing' ? 'opacity-60 transition-opacity' : 'transition-opacity'
          }
          aria-busy={state.status === 'refreshing'}
        >
          {children(data.rows)}
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={onPage} />
        </div>
      )}
    </Panel>
  )
}

interface SearchFieldProps {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}

export function SearchField({ id, label, placeholder, value, onChange }: SearchFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-md font-semibold text-on-surface">
        {label}
      </label>
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline"
        />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-outline-variant bg-surface py-2.5 pl-10 pr-3.5 text-body-md placeholder:text-placeholder"
        />
      </div>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mb-4 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
    >
      {children}
    </p>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
    >
      {children}
    </p>
  )
}
