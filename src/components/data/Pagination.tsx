import { Button } from '@/components/ui'
import { formatNumber } from '@/utils/format'
import { pageCount } from '@/utils/listParams'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = pageCount(total, pageSize)
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-label-md text-on-surface-variant"
    >
      <p aria-live="polite">
        Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5"
        >
          Previous
        </Button>
        <span className="tabular-nums">
          Page {formatNumber(page)} of {formatNumber(pages)}
        </span>
        <Button
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5"
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
