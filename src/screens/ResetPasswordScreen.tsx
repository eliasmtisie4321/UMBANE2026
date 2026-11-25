import { Check, Circle, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Button, Input } from '@/components/ui'
import { AuthLayout } from '@/layouts/AuthLayout'
import { passwordChecks, passwordIsValid } from '@/utils/validation'

const RULES: Array<[keyof ReturnType<typeof passwordChecks>, string]> = [
  ['length', 'At least 8 characters'],
  ['uppercase', 'One uppercase letter'],
  ['number', 'One number'],
  ['special', 'One special character'],
]

export default function ResetPasswordScreen() {
  const { status, updatePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'loading') return <FullPageSpinner />

  // The emailed link signs the user in with a short-lived recovery session. Without one the link is invalid.
  if (status !== 'authenticated') {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-headline-md font-semibold text-on-surface">
          This link is not valid
        </h1>
        <p className="mb-6 text-body-md text-on-surface-variant">
          The password reset link is invalid or has expired. Request a new one to continue.
        </p>
        <Link
          to="/forgot-password"
          className="text-label-md font-medium text-secondary hover:text-primary"
        >
          Request a new link
        </Link>
      </AuthLayout>
    )
  }

  const checks = passwordChecks(password)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!passwordIsValid(password)) {
      setError('Your password does not meet all the requirements.')
      return
    }
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await updatePassword(password)
    if (!result.ok) {
      setSubmitting(false)
      setError(result.error.message)
      return
    }
    // Make the user sign in again with the new password.
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-headline-md font-semibold text-on-surface">Create a New Password</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">
        Choose a strong password for your account.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="Enter new password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leadingIcon={<Lock size={18} />}
        />
        <ul aria-label="Password requirements" className="flex flex-col gap-1 text-label-md">
          {RULES.map(([key, label]) => (
            <li
              key={key}
              className={`flex items-center gap-2 ${checks[key] ? 'text-success' : 'text-on-surface-variant'}`}
            >
              {checks[key] ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Circle size={14} aria-hidden="true" />
              )}
              {label}
              <span className="sr-only">{checks[key] ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
        <Input
          id="confirm-password"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={error ?? undefined}
          leadingIcon={<Lock size={18} />}
        />
        <Button type="submit" loading={submitting} className="w-full">
          Reset Password
        </Button>
      </form>
    </AuthLayout>
  )
}
