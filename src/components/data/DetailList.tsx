import type { ReactNode } from 'react'

export interface DetailItem {
  label: string
  value: ReactNode
}

/** Label/value pairs as a description list. Missing values show a dash so layout stays steady. */
export function DetailList({ items }: { items: DetailItem[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-label-sm font-medium uppercase tracking-wide text-on-surface-variant">
            {label}
          </dt>
          <dd className="mt-0.5 break-words text-body-md text-on-surface">
            {value === null || value === undefined || value === '' ? '-' : value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
