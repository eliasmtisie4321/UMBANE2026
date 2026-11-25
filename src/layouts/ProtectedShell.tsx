import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { canAccess, navFor } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { ROLE_LABEL } from '@/types/auth'
import ForbiddenScreen from '@/screens/ForbiddenScreen'
import { AppLayout } from './AppLayout'

/**
 * Wraps every signed-in route. Redirects to /login when there is no valid session and
 * shows a "no access" page when the role may not open the current path.
 */
export function ProtectedShell() {
  const { status, profile, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (status === 'loading') return <FullPageSpinner />
  if (status !== 'authenticated' || !profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <AppLayout
      currentPath={location.pathname}
      navItems={navFor(profile.role)}
      onNavigate={(to) => navigate(to)}
      onSignOut={() => void signOut()}
      userName={profile.full_name || profile.email || undefined}
      roleLabel={ROLE_LABEL[profile.role]}
    >
      {canAccess(profile.role, location.pathname) ? <Outlet /> : <ForbiddenScreen />}
    </AppLayout>
  )
}
