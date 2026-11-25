import { Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { Button, Input } from '@/components/ui'
import { AuthLayout } from '@/layouts/AuthLayout'
import { isValidEmail } from '@/utils/validation'

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.')
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await requestPasswordReset(email)
    setSubmitting(false)
    if (result.ok) setSent(true)
    else setError(result.error.message)
  }

  if (sent) {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-headline-md font-semibold text-on-surface">Check your email</h1>
        {/* Same message whether or not the address exists, so accounts cannot be probed. */}
        <p className="mb-6 text-body-md text-on-surface-variant">
          If an account exists for <strong>{email.trim()}</strong>, we have sent a secure link to
          reset your password. The link expires after a short time.
        </p>
        <Link to="/login" className="text-label-md font-medium text-secondary hover:text-primary">
          Back to Login
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-headline-md font-semibold text-on-surface">Forgot your password?</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">
        Enter the email address registered with your Umbane CRM account and we will send you a
        secure link to reset your password.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@umbane.co.za"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error ?? undefined}
          leadingIcon={<Mail size={18} />}
        />
        <Button type="submit" loading={submitting} className="w-full">
          Send Reset Link
        </Button>
        <Link
          to="/login"
          className="text-center text-label-md font-medium text-secondary hover:text-primary"
        >
          Back to Login
        </Link>
      </form>
    </AuthLayout>
  )
}
