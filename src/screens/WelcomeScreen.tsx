import { Check, Circle, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Button, Input } from '@/components/ui'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ROLE_LABEL } from '@/types/auth'
import { passwordChecks, passwordIsValid } from '@/utils/validation'

const RULES: Array<[keyof ReturnType<typeof passwordChecks>, string]> = [
  ['length', 'At least 8 characters'],
  ['uppercase', 'One uppercase letter'],
  ['number', 'One number'],
  ['special', 'One special character'],
]

/**
 * Where a team invitation link lands. Supabase Auth has already confirmed the address and signed
 * the person in; the database created their profile from the invitation. They choose a password
 * and go straight in.
 */
export default function WelcomeScreen() {
  const { status, profile, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'loading') return <FullPageSpinner />

  if (status !== 'authenticated' || !profile) {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-headline-md font-semibold text-on-surface">
          This invitation link does not work
        </h1>
        <p className="mb-6 text-body-md text-on-surface-variant">
          It may have expired, been used already, or the invitation was cancelled. Ask the person
          who invited you to send a new one. If you have already set your password, sign in.
        </p>
        <Link to="/login" className="text-label-md font-medium text-secondary hover:text-primary">
          Go to sign in
        </Link>
      </AuthLayout>
    )
  }

  const checks = passwordChecks(password)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!passwordIsValid(password))
      return setError('Your password does not meet all the requirements.')
    if (password !== confirm) return setError('The passwords do not match.')
    setError(null)
    setSubmitting(true)
    const result = await updatePassword(password)
    setSubmitting(false)
    if (!result.ok) return setError(result.error.message)
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-headline-md font-semibold text-on-surface">
        Welcome, {profile.full_name}
      </h1>
      <p className="mb-6 text-body-md text-on-surface-variant">
        You have joined as {ROLE_LABEL[profile.role]}. Choose a password to finish setting up your
        account.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          id="welcome-password"
          label="Password"
          type="password"
          autoComplete="new-password"
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
          id="welcome-confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={error ?? undefined}
          leadingIcon={<Lock size={18} />}
        />
        <Button type="submit" loading={submitting} className="w-full">
          Set Password and Continue
        </Button>
      </form>
    </AuthLayout>
  )
}
