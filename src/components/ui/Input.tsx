import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'
import { Field } from './Field'
import { controlClass, describedBy } from './fieldStyles'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
  hint?: string
}

export function Input({ id, label, error, hint, className, ...rest }: InputProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, error ? 'border-error' : 'border-outline-variant', className)}
        {...rest}
      />
    </Field>
  )
}
