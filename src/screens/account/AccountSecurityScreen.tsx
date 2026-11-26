import { LogOut } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Panel } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input } from '@/components/ui'
import { useAuth } from '@/auth/useAuth'
import { changePassword, signOutOtherSessions } from '@/services/auth'
import { logSecurityEvent } from '@/services/settings'
import { validateNewPassword, type PasswordErrors } from '@/utils/settingsForm'

function PasswordForm() {
  const { profile } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setNotice(null)
    setError(null)
    const found = validateNewPassword(current, next, confirm)
    setErrors(found)
    if (Object.keys(found).length > 0 || !profile?.email) return
    setSaving(true)
    const result = await changePassword(profile.email, current, next)
    setSaving(false)
    if (!result.ok) {
      if (result.error.field === 'current') setErrors({ current: result.error.message })
      else setError(result.error.message)
      return
    }
    void logSecurityEvent('password_changed')
    setCurrent('')
    setNext('')
    setConfirm('')
    setNotice('Your password was changed.')
  }

  return (
    <Panel
      title="Change password"
      subtitle="At least 12 characters, with upper and lower case letters and a number."
    >
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-3">
          <FormError>{error}</FormError>
        </div>
      )}
      <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-md grid-cols-1 gap-4">
        <Input
          id="password-current"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.current}
        />
        <Input
          id="password-new"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.next}
        />
        <Input
          id="password-confirm"
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <div>
          <Button type="submit" loading={saving}>
            Change Password
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function OtherSessions() {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    const result = await signOutOtherSessions()
    setBusy(false)
    setAsking(false)
    if (!result.ok) return setError(result.error.message)
    void logSecurityEvent('signed_out_other_sessions')
    setNotice('You are signed out everywhere else. This browser stays signed in.')
  }

  return (
    <Panel
      title="Other devices"
      subtitle="If you signed in on a shared or lost device, sign out of everything except this browser."
    >
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-3">
          <FormError>{error}</FormError>
        </div>
      )}
      <Button variant="secondary" onClick={() => setAsking(true)}>
        <LogOut size={16} aria-hidden="true" /> Sign Out Other Devices
      </Button>
      <ConfirmDialog
        open={asking}
        title="Sign out of all other devices?"
        confirmLabel="Sign Out Others"
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setAsking(false)}
      >
        Every other browser and phone signed in as you is signed out straight away. This one stays
        signed in.
      </ConfirmDialog>
    </Panel>
  )
}

/** The signed-in person's own password and sessions. Open to every role. */
export default function AccountSecurityScreen() {
  const { profile } = useAuth()
  return (
    <>
      <PageHeader
        title="Your password and sign-in"
        subtitle={profile?.email ? `Signed in as ${profile.email}.` : undefined}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PasswordForm />
        <OtherSessions />
      </div>
    </>
  )
}
