import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

interface AppLayoutProps {
  currentPath?: string
  onNavigate?: (to: string) => void
  children: ReactNode
}

/** Authenticated page shell: sidebar (drawer on mobile), top bar, max-w-7xl content. */
export function AppLayout({ currentPath = '/', onNavigate, children }: AppLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="flex min-h-screen bg-surface-container-low">
      <Sidebar
        currentPath={currentPath}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(to) => {
          setMenuOpen(false)
          onNavigate?.(to)
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
