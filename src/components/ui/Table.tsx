import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from './cn'

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    // `relative` matters: absolutely positioned children (the sr-only caption and header labels)
    // are only clipped by a scroll container that is itself positioned. Without it they sit at the
    // far end of a wide table and stretch the whole page sideways on phones.
    <div className="relative overflow-x-auto rounded-lg border border-outline-variant bg-surface">
      <table className={cn('w-full text-left text-body-md', className)} {...rest} />
    </div>
  )
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-outline-variant bg-surface-container-low px-4 py-3 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant',
        className,
      )}
      {...rest}
    />
  )
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-outline-variant px-4 py-3 tabular-nums', className)}
      {...rest}
    />
  )
}
