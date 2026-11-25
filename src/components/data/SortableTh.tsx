import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Th } from '@/components/ui'

interface SortableThProps {
  label: string
  /** True when the table is currently sorted by this column. */
  active: boolean
  ascending: boolean
  onSort: () => void
  className?: string
}

/** Column header that sorts on click. aria-sort tells assistive tech which column is sorted and how. */
export function SortableTh({ label, active, ascending, onSort, className }: SortableThProps) {
  const Icon = !active ? ArrowUpDown : ascending ? ArrowUp : ArrowDown
  return (
    <Th
      className={className}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1.5 text-left font-semibold uppercase tracking-wide hover:text-primary"
      >
        {label}
        <Icon size={14} aria-hidden="true" className={active ? 'text-primary' : 'opacity-50'} />
      </button>
    </Th>
  )
}
