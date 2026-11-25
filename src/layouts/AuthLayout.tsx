import { Zap } from 'lucide-react'
import type { ReactNode } from 'react'

interface AuthLayoutProps {
  /** Welcome copy shown beside the card on large screens. */
  aside?: ReactNode
  children: ReactNode
}

/** Shell for signed-out screens: brand header, optional welcome column, centred card. */
export function AuthLayout({ aside, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto w-full max-w-7xl px-6 pt-6 lg:px-8 lg:pt-8">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary shadow-sm">
            <Zap size={22} className="fill-tertiary text-tertiary" aria-hidden="true" />
          </span>
          <span className="text-title-lg font-semibold text-primary">Umbane</span>
          <span className="rounded-sm bg-tertiary-container px-1.5 py-0.5 text-label-sm text-on-tertiary-container">
            CRM
          </span>
        </span>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-6 py-8 lg:px-8 lg:py-12">
        <div className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          {aside && <section className="hidden lg:col-span-7 lg:block">{aside}</section>}
          <section
            className={
              aside
                ? 'flex justify-center lg:col-span-5 lg:justify-end'
                : 'flex justify-center lg:col-span-12'
            }
          >
            <article className="w-full max-w-md rounded-xl border border-outline-variant bg-surface p-6 shadow-card sm:p-8">
              {children}
            </article>
          </section>
        </div>
      </main>
      <footer className="mx-auto w-full max-w-7xl px-6 pb-6 text-label-sm text-on-surface-variant lg:px-8">
        © 2026 Umbane Energy Operations. All rights reserved.
      </footer>
    </div>
  )
}
