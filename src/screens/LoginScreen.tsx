import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Button, Input } from '@/components/ui'
import { AuthLayout } from '@/layouts/AuthLayout'
import { isValidEmail } from '@/utils/validation'

const aside = (
  <div className="flex max-w-xl flex-col gap-4">
    <span className="inline-flex items-center gap-2 self-start rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-label-sm text-on-surface-variant">
      <span className="h-2 w-2 rounded-full bg-tertiary" aria-hidden="true" />
      Smart Grid &amp; Utility Operations
    </span>
    <p className="text-display-lg font-bold tracking-tight text-primary" aria-hidden="true">
      Welcome Back to Umbane
    </p>
    <p className="text-title-md text-on-surface-variant">
      Manage your customers, properties, electricity meters and business operations in one place.
    </p>
  </div>
)

export default function LoginScreen() {
  const auth = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (auth.status === 'loading') return <FullPageSpinner />
  if (auth.status === 'authenticated' && auth.profile) return <Navigate to={from} replace />

  const notice =
    auth.configError ??
    auth.accessError ??
    (auth.sessionExpired ? 'Your session expired. Please sign in again.' : null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!email.trim()) next.email = 'Enter your email address.'
    else if (!isValidEmail(email)) next.email = 'Enter a valid email address.'
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    setFormError(null)
    if (next.email || next.password) return

    setSubmitting(true)
    const result = await auth.signIn(email, password)
    setSubmitting(false)
    if (!result.ok) setFormError(result.error.message)
  }

  return (
    <AuthLayout aside={aside}>
      <header className="mb-6 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-headline-md font-semibold text-on-surface">Sign In</h1>
          <span className="h-1 w-8 rounded-full bg-tertiary" aria-hidden="true" />
        </div>
        <p className="text-body-md text-on-surface-variant">
          Enter your workspace credentials to continue.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {notice && (
          <p
            role="alert"
            className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
          >
            {notice}
          </p>
        )}
        <Input
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@umbane.co.za"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          leadingIcon={<Mail size={18} />}
        />
        <Input
          id="password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          leadingIcon={<Lock size={18} />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container"
            >
              {showPassword ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          }
        />
        {formError && (
          <p
            role="alert"
            className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
          >
            {formError}
          </p>
        )}
        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-label-md font-medium text-secondary hover:text-primary"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={submitting} disabled={!!auth.configError} className="w-full">
          Sign In
        </Button>
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-outline-variant" />
          <span className="text-label-sm text-on-surface-variant">New to Umbane?</span>
          <span className="h-px flex-1 bg-outline-variant" />
        </div>
        <Link
          to="/create-account"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-outline bg-surface px-4 text-label-md font-medium text-primary hover:bg-surface-container"
        >
          Create Account
        </Link>
      </form>
    </AuthLayout>
  )
}
