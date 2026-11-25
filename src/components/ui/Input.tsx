import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { Field } from './Field'
import { controlClass, describedBy } from './fieldStyles'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
  hint?: string
  /** Decorative icon shown inside the field, left side. */
  leadingIcon?: ReactNode
  /** Interactive element shown inside the field, right side (e.g. show/hide password). */
  trailing?: ReactNode
}

export function Input({
  id,
  label,
  error,
  hint,
  leadingIcon,
  trailing,
  className,
  ...rest
}: InputProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="relative flex items-center">
        {leadingIcon && (
          <span
            className="pointer-events-none absolute left-3.5 flex items-center text-outline"
            aria-hidden="true"
          >
            {leadingIcon}
          </span>
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(
            controlClass,
            leadingIcon ? 'pl-10' : false,
            trailing ? 'pr-11' : false,
            error ? 'border-error' : 'border-outline-variant',
            className,
          )}
          {...rest}
        />
        {trailing && <span className="absolute right-1.5 flex items-center">{trailing}</span>}
      </div>
    </Field>
  )
}
