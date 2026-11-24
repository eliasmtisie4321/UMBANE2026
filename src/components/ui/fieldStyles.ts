export const controlClass =
  'w-full rounded-md border bg-surface px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-outline focus:border-secondary disabled:bg-surface-container disabled:opacity-60'

export const describedBy = (id: string, error?: string, hint?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined
