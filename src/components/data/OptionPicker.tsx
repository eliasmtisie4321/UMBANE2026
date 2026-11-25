import { useState } from 'react'
import { ErrorNotice } from '@/components/dashboard/Panel'
import { Button, Input } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import type { Result } from '@/types/api'

interface OptionPickerProps<T extends { id: string }> {
  id: string
  label: string
  placeholder: string
  /** Plural noun for messages, e.g. "customers". */
  noun: string
  selected: T | null
  error?: string
  search: (text: string) => Promise<Result<T[]>>
  title: (option: T) => string
  detail: (option: T) => string | null
  onSelect: (option: T | null) => void
}

/**
 * Search-and-choose for a record. Shows matches as buttons under the search box; once one is
 * chosen it collapses to a summary with a "Change" button.
 */
export function OptionPicker<T extends { id: string }>({
  id,
  label,
  placeholder,
  noun,
  selected,
  error,
  search: runSearch,
  title,
  detail,
  onSelect,
}: OptionPickerProps<T>) {
  const [query, setQuery] = useState('')
  const search = useDebouncedValue(query, 250)
  const results = useResource(() => runSearch(search), `picker-${noun}-${search}`)

  if (selected) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label-md font-semibold text-on-surface">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant bg-surface-container-low px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-body-md font-medium text-on-surface">{title(selected)}</p>
            {detail(selected) && (
              <p className="truncate text-label-sm text-on-surface-variant">{detail(selected)}</p>
            )}
          </div>
          <Button
            variant="secondary"
            className="px-3 py-1.5"
            onClick={() => onSelect(null)}
            aria-label={`Change ${label.toLowerCase()}`}
          >
            Change
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        label={label}
        type="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        error={error}
        autoComplete="off"
      />
      {results.status === 'loading' && (
        <p role="status" className="text-label-md text-on-surface-variant">
          Searching…
        </p>
      )}
      {results.status === 'error' && (
        <ErrorNotice message={results.error.message} onRetry={results.reload} />
      )}
      {results.data && results.data.length === 0 && (
        <p className="text-label-md text-on-surface-variant">No {noun} match that search.</p>
      )}
      {results.data && results.data.length > 0 && (
        <ul
          aria-label={`Matching ${noun}`}
          className="divide-y divide-outline-variant overflow-hidden rounded-md border border-outline-variant"
        >
          {results.data.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onSelect(o)}
                className="flex w-full flex-col items-start px-3.5 py-2.5 text-left hover:bg-surface-container-low"
              >
                <span className="text-body-md font-medium text-on-surface">{title(o)}</span>
                {detail(o) && (
                  <span className="text-label-sm text-on-surface-variant">{detail(o)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
