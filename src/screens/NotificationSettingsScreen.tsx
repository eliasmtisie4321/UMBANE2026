import { useState } from 'react'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/auth/useAuth'
import { useResource } from '@/hooks/useResource'
import { getPreferences, savePreferences } from '@/services/notifications'
import { NOTIFICATION_CATEGORIES, type NotificationPreference } from '@/types/automations'

function Choices({ initial, isClient }: { initial: NotificationPreference[]; isClient: boolean }) {
  const { profile } = useAuth()
  const [prefs, setPrefs] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = NOTIFICATION_CATEGORIES.filter((c) => !isClient || c.clients)
  const changed = JSON.stringify(prefs) !== JSON.stringify(saved)

  const set = (category: string, field: 'inApp' | 'email', value: boolean) =>
    setPrefs((all) => all.map((p) => (p.category === category ? { ...p, [field]: value } : p)))

  async function save() {
    if (!profile) return
    setSaving(true)
    setNotice(null)
    setError(null)
    const result = await savePreferences(profile.id, prefs)
    setSaving(false)
    if (!result.ok) return setError(result.error.message)
    setSaved(prefs)
    setNotice('Notification settings saved.')
  }

  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <Panel
        title="What you hear about, and how"
        subtitle={`Email goes to ${profile?.email ?? 'your sign-in address'}. Switching both off means you are not told at all.`}
      >
        <Table>
          <caption className="sr-only">Notification settings by kind of notification</caption>
          <thead>
            <tr>
              <Th>Kind of notification</Th>
              <Th className="text-center">In the app</Th>
              <Th className="text-center">By email</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const p = prefs.find((x) => x.category === c.value)!
              return (
                <tr key={c.value}>
                  <Td className="min-w-56">
                    <span className="block font-semibold text-on-surface">{c.label}</span>
                    <span className="block text-label-md text-on-surface-variant">
                      {c.description}
                    </span>
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-primary"
                      checked={p.inApp}
                      aria-label={`${c.label} in the app`}
                      onChange={(e) => set(c.value, 'inApp', e.target.checked)}
                    />
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-primary"
                      checked={p.email}
                      aria-label={`${c.label} by email`}
                      onChange={(e) => set(c.value, 'email', e.target.checked)}
                    />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} loading={saving} disabled={!changed && !error}>
            Save Settings
          </Button>
          <p className="text-label-md text-on-surface-variant">
            Emails go out within a few minutes while anyone is using Umbane, otherwise at the next
            morning run. Emails older than two days are not sent.
          </p>
        </div>
      </Panel>
    </>
  )
}

/** Each person's own choice, per kind of notification, of in-app and email. */
export default function NotificationSettingsScreen() {
  const { profile } = useAuth()
  const state = useResource(() => getPreferences(), 'notification-preferences')
  return (
    <>
      <PageHeader
        title="Notification settings"
        subtitle="Choose which notifications you see in Umbane and which also come by email."
        back={{ to: '/notifications', label: 'Notifications' }}
      />
      <ResourceBoundary state={state} skeletonLines={6}>
        {(prefs) => <Choices initial={prefs} isClient={profile?.role === 'client'} />}
      </ResourceBoundary>
    </>
  )
}
