import type { ReactNode } from 'react'

export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-outline-variant bg-surface p-5 shadow-card"
    >
      <h2 className="text-title-md font-semibold text-on-surface">{title}</h2>
      {description && <p className="mt-0.5 text-label-md text-on-surface-variant">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}
