import { Bell, KeyRound, LogOut, Menu, Search, User } from 'lucide-react'
import { useState } from 'react'
import { Clock } from '@/components/topbar/Clock'
import { GlobalSearch } from '@/components/topbar/GlobalSearch'
import { QuickAdd } from '@/components/topbar/QuickAdd'
import { Dropdown, Modal } from '@/components/ui'
import type { UserRole } from '@/types/auth'

interface TopBarProps {
  onOpenMenu: () => void
  onOpenNotifications?: () => void
  unread?: number
  onSignOut?: () => void
  /** Opens the person's own password and sign-in page. */
  onOpenSecurity?: () => void
  /** Opens a page (search results, Quick Add). */
  onNavigate?: (to: string) => void
  /** Decides what search may show and what Quick Add offers. */
  role?: UserRole
  userName?: string
  roleLabel?: string
}

export function TopBar({
  onOpenMenu,
  onOpenNotifications,
  unread = 0,
  onSignOut,
  onOpenSecurity,
  onNavigate,
  role,
  userName,
  roleLabel,
}: TopBarProps) {
  const [searching, setSearching] = useState(false)
  const go = (to: string) => onNavigate?.(to)
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
      {role && (
        <div role="search" className="hidden max-w-md flex-1 sm:block">
          <GlobalSearch role={role} onNavigate={go} shortcut />
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {role && (
          <button
            type="button"
            onClick={() => setSearching(true)}
            aria-label="Search"
            className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container sm:hidden"
          >
            <Search size={20} aria-hidden="true" />
          </button>
        )}
        <Clock />
        {role && <QuickAdd role={role} onNavigate={go} />}
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
      {searching && role && (
        <Modal open title="Search" onClose={() => setSearching(false)}>
          <div role="search" className="min-h-64">
            <GlobalSearch
              role={role}
              onNavigate={go}
              autoFocus
              onDone={() => setSearching(false)}
            />
          </div>
        </Modal>
      )}
    </header>
  )
}
