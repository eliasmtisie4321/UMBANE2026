import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import type { NavItem } from './navItems'
import type { UserRole } from '@/types/auth'

interface AppLayoutProps {
  currentPath?: string
  onNavigate?: (to: string) => void
  navItems?: NavItem[]
  onSignOut?: () => void
  userName?: string
  roleLabel?: string
  unread?: number
  /** The signed-in person's role: what search and Quick Add offer. */
  role?: UserRole
  children: ReactNode
}

/** Authenticated page shell: sidebar (drawer on mobile), top bar, max-w-7xl content. */
export function AppLayout({
  currentPath = '/',
  onNavigate,
  navItems,
  onSignOut,
  userName,
  roleLabel,
  unread,
  role,
  children,
}: AppLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="flex min-h-screen bg-surface-container-low">
      <Sidebar
        currentPath={currentPath}
        navItems={navItems}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(to) => {
          setMenuOpen(false)
          onNavigate?.(to)
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenMenu={() => setMenuOpen(true)}
          onOpenNotifications={() => onNavigate?.('/notifications')}
          unread={unread}
          onSignOut={onSignOut}
          onOpenSecurity={() => onNavigate?.('/account/security')}
          onNavigate={onNavigate}
          role={role}
          userName={userName}
          roleLabel={roleLabel}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
