import type { SelectHTMLAttributes } from 'react'
import { cn } from './cn'
import { Field } from './Field'
import { controlClass, describedBy } from './fieldStyles'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string
  label: string
  options: Array<{ value: string; label: string }>
  error?: string
  hint?: string
}

export function Select({ id, label, options, error, hint, className, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, error ? 'border-error' : 'border-outline-variant', className)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
