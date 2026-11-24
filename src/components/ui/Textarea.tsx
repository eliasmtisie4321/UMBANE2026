import type { TextareaHTMLAttributes } from 'react'
import { cn } from './cn'
import { Field } from './Field'
import { controlClass, describedBy } from './fieldStyles'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string
  label: string
  error?: string
  hint?: string
}

export function Textarea({ id, label, error, hint, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, error ? 'border-error' : 'border-outline-variant', className)}
        {...rest}
      />
    </Field>
  )
}
