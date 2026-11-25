import { useAuth } from '@/auth/useAuth'
import { Card } from '@/components/ui'
import { ROLE_LABEL } from '@/types/auth'

export default function OverviewScreen() {
  const { profile } = useAuth()
  const first = profile?.full_name.split(' ')[0]
  return (
    <>
      <h1 className="mb-1 text-headline-lg font-bold text-primary">
        {first ? `Welcome, ${first}` : 'Welcome'}
      </h1>
      {profile && (
        <p className="mb-6 text-on-surface-variant">Signed in as {ROLE_LABEL[profile.role]}</p>
      )}
      <Card>
        <p className="text-on-surface-variant">The dashboard arrives in a later phase.</p>
      </Card>
    </>
  )
}
