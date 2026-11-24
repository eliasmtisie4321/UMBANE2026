import { Bell, LogOut, Menu, Search, User } from 'lucide-react'
import { Dropdown } from '@/components/ui'

interface TopBarProps {
  onOpenMenu: () => void
}

export function TopBar({ onOpenMenu }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-outline-variant bg-surface px-4 lg:px-8">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
        className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container lg:hidden"
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <div role="search" className="relative hidden max-w-md flex-1 sm:block">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-outline"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search customers, meters, invoices"
          className="w-full rounded-md border border-outline-variant bg-surface-container-low py-2 pl-9 pr-3 text-body-md placeholder:text-outline"
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container"
        >
          <Bell size={20} aria-hidden="true" />
        </button>
        <Dropdown label="Account menu" trigger={<User size={20} aria-hidden="true" />}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-label-md hover:bg-surface-container"
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </Dropdown>
      </div>
    </header>
  )
}
