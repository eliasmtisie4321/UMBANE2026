import { useState } from 'react'
import { ErrorNotice } from '@/components/dashboard/Panel'
import { Button, Input } from '@/components/ui'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useResource } from '@/hooks/useResource'
import { searchCustomerOptions } from '@/services/properties'
import type { CustomerOption } from '@/types/properties'

interface CustomerPickerProps {
  id: string
  label: string
  selected: CustomerOption | null
  error?: string
  onSelect: (customer: CustomerOption | null) => void
}

const describe = (c: CustomerOption) => (c.companyName ? `${c.name} (${c.companyName})` : c.name)

/**
 * Search-and-choose for a customer. Shows matches as buttons under the search box; once one is
 * chosen it collapses to a summary with a "Change" button.
 */
export function CustomerPicker({ id, label, selected, error, onSelect }: CustomerPickerProps) {
  const [query, setQuery] = useState('')
  const search = useDebouncedValue(query, 250)
  const results = useResource(() => searchCustomerOptions(search), `picker-${search}`)

  if (selected) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-label-md font-semibold text-on-surface">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant bg-surface-container-low px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-body-md font-medium text-on-surface">
              {describe(selected)}
            </p>
            {selected.email && (
              <p className="truncate text-label-sm text-on-surface-variant">{selected.email}</p>
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
        placeholder="Search customer by name, email or company"
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
        <p className="text-label-md text-on-surface-variant">No customers match that search.</p>
      )}
      {results.data && results.data.length > 0 && (
        <ul
          aria-label="Matching customers"
          className="divide-y divide-outline-variant overflow-hidden rounded-md border border-outline-variant"
        >
          {results.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="flex w-full flex-col items-start px-3.5 py-2.5 text-left hover:bg-surface-container-low"
              >
                <span className="text-body-md font-medium text-on-surface">{describe(c)}</span>
                {c.email && (
                  <span className="text-label-sm text-on-surface-variant">{c.email}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
