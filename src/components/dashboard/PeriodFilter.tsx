import { cn } from '@/components/ui/cn'
import type { PeriodMonths } from '@/types/dashboard'

const OPTIONS: Array<{ value: PeriodMonths; label: string }> = [
  { value: 3, label: 'Last 3 months' },
  { value: 6, label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
]

interface PeriodFilterProps {
  value: PeriodMonths
  onChange: (value: PeriodMonths) => void
}

/** Date range presets. Scopes the revenue chart and recent payments below it. */
export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Date range"
      className="inline-flex rounded-md border border-outline-variant bg-surface p-0.5"
    >
      {OPTIONS.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded px-3 py-1.5 text-label-md font-medium transition-colors duration-[120ms]',
              selected
                ? 'bg-primary-container text-primary'
                : 'text-on-surface-variant hover:bg-surface-container-low',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
