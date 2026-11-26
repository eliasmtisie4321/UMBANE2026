import { Bell, LogOut, Menu, Plus, Search, User, KeyRound } from 'lucide-react'
import { Button, Dropdown } from '@/components/ui'

interface TopBarProps {
  onOpenMenu: () => void
  onOpenNotifications?: () => void
  unread?: number
  onSignOut?: () => void
  /** Opens the person's own password and sign-in page. */
  onOpenSecurity?: () => void
  userName?: string
  roleLabel?: string
}

export function TopBar({
  onOpenMenu,
  onOpenNotifications,
  unread = 0,
  onSignOut,
  onOpenSecurity,
  userName,
  roleLabel,
}: TopBarProps) {
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
      <div className="ml-auto flex items-center gap-2">
        <Button className="hidden sm:inline-flex">
          <Plus size={16} aria-hidden="true" /> Quick Add
        </Button>
        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative rounded-md p-2 text-on-surface-variant hover:bg-surface-container"
        >
          <Bell size={20} aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-error px-1 text-center text-[10px] font-bold leading-4 text-on-error"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        {userName && (
          <div className="hidden text-right leading-tight md:block">
            <p className="text-label-md font-semibold text-on-surface">{userName}</p>
            {roleLabel && <p className="text-label-sm text-on-surface-variant">{roleLabel}</p>}
          </div>
        )}
        <Dropdown label="Account menu" trigger={<User size={20} aria-hidden="true" />}>
          {onOpenSecurity && (
            <button
              type="button"
              onClick={onOpenSecurity}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-label-md hover:bg-surface-container"
            >
              <KeyRound size={16} aria-hidden="true" /> Password and sign-in
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-label-md hover:bg-surface-container"
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </Dropdown>
      </div>
    </header>
  )
}
