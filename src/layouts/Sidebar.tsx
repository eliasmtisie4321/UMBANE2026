import { X, Zap } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import { NAV_ITEMS, type NavItem } from './navItems'

interface SidebarProps {
  currentPath: string
  open: boolean
  onClose: () => void
  onNavigate?: (to: string) => void
  navItems?: NavItem[]
}

export function Sidebar({
  currentPath,
  open,
  onClose,
  onNavigate,
  navItems = NAV_ITEMS,
}: SidebarProps) {
  return (
    <>
      {open && (
        <div
          data-testid="sidebar-backdrop"
          className="fixed inset-0 z-30 bg-on-surface/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="Primary navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-outline-variant bg-surface transition-transform duration-[220ms] lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-outline-variant/70 px-6">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary">
              <Zap size={20} className="fill-tertiary text-tertiary" aria-hidden="true" />
            </span>
            <span className="text-title-lg font-semibold text-primary">Umbane</span>
            <span className="rounded-sm bg-tertiary-container px-1.5 py-0.5 text-label-sm text-on-tertiary-container">
              CRM
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container lg:hidden"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 overflow-y-auto p-2">
          {navItems.map(({ to, label, icon: Icon }) => {
            // Highlight a section while anywhere inside it (/customers/123/edit keeps Customers lit).
            const active =
              to === '/'
                ? currentPath === '/'
                : currentPath === to || currentPath.startsWith(`${to}/`)
            return (
              <a
                key={to}
                href={to}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault()
                    onNavigate(to)
                  }
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-label-md font-medium transition-colors duration-[120ms]',
                  active
                    ? 'bg-primary-container text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary',
                )}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
                {active && (
                  <span
                    className="ml-auto h-1.5 w-1.5 rounded-full bg-tertiary"
                    aria-hidden="true"
                  />
                )}
              </a>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
