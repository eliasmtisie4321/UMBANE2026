import { Suspense, useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { canAccess, navFor } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Spinner } from '@/components/ui/Spinner'
import { useResource } from '@/hooks/useResource'
import { flushNotificationEmails, getUnreadCount } from '@/services/notifications'
import { ROLE_LABEL, type Profile } from '@/types/auth'
import ForbiddenScreen from '@/screens/ForbiddenScreen'
import { AppLayout } from './AppLayout'

/**
 * Wraps every signed-in route. Redirects to /login when there is no valid session and
 * shows a "no access" page when the role may not open the current path.
 */
export function ProtectedShell() {
  const { status, profile } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner />
  if (status !== 'authenticated' || !profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <SignedInShell profile={profile} />
}

function SignedInShell({ profile }: { profile: Profile }) {
  const { signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // Checked again on every page change, so the count follows what the person has read.
  const unread = useResource(() => getUnreadCount(), `unread-${location.pathname}`)
  // Sends queued notification emails within minutes while anyone is signed in (at most once a
  // minute; see flushNotificationEmails).
  useEffect(() => {
    void flushNotificationEmails()
  }, [location.pathname])

  return (
    <AppLayout
      currentPath={location.pathname}
      navItems={navFor(profile.role)}
      onNavigate={(to) => navigate(to)}
      onSignOut={() => void signOut()}
      userName={profile.full_name || profile.email || undefined}
      roleLabel={ROLE_LABEL[profile.role]}
      role={profile.role}
      unread={unread.data ?? 0}
    >
      {canAccess(profile.role, location.pathname) ? (
        // Each screen is its own download (src/App.tsx), so a page shows this while it arrives.
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      ) : (
        <ForbiddenScreen />
      )}
    </AppLayout>
  )
}

function PageLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-on-surface-variant">
      <Spinner size={20} label="Loading page" />
      <span aria-hidden="true">Loading…</span>
    </div>
  )
}
