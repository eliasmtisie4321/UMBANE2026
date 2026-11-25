import { Mail, Phone, User } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Input, Textarea } from '@/components/ui'
import { AuthLayout } from '@/layouts/AuthLayout'
import { requestAccess } from '@/services/accessRequests'
import { normalizePhone } from '@/utils/phone'
import { isValidEmail } from '@/utils/validation'

type Field = 'fullName' | 'email' | 'phone' | 'message'

export default function CreateAccountScreen() {
  const [values, setValues] = useState({ fullName: '', email: '', phone: '', message: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const set = (field: Field, value: string) => setValues((v) => ({ ...v, [field]: value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (values.fullName.trim().length < 2) next.fullName = 'Enter your full name.'
    if (!values.email.trim()) next.email = 'Enter your email address.'
    else if (!isValidEmail(values.email)) next.email = 'Enter a valid email address.'
    const phone = values.phone.trim() ? normalizePhone(values.phone) : ''
    if (phone === null || (phone && !/^\+27\d{9}$/.test(phone))) {
      next.phone = 'Enter a South African number, for example 082 441 9082.'
    }
    if (values.message.length > 500) next.message = 'Keep your message under 500 characters.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    const result = await requestAccess({ ...values, phone: phone ?? '' })
    setSubmitting(false)
    if (result.ok) setSentTo(values.email.trim())
    else setFormError(result.error.message)
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <h1 className="mb-2 text-headline-md font-semibold text-on-surface">Request received</h1>
        {/* Same message whether or not the address is already known, so nothing can be probed. */}
        <p className="mb-6 text-body-md text-on-surface-variant">
          Thank you. An administrator will review your request and, once approved, send an
          invitation to <strong>{sentTo}</strong> so you can set a password and sign in.
        </p>
        <Link to="/login" className="text-label-md font-medium text-secondary hover:text-primary">
          Back to Login
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-headline-md font-semibold text-on-surface">Create an account</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">
        Accounts are set up by an administrator. Tell us who you are and we will get back to you.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p
            role="alert"
            className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
          >
            {formError}
          </p>
        )}
        <Input
          id="full-name"
          label="Full name"
          autoComplete="name"
          placeholder="Thandi Nkosi"
          value={values.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          error={errors.fullName}
          leadingIcon={<User size={18} />}
        />
        <Input
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@umbane.co.za"
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          leadingIcon={<Mail size={18} />}
        />
        <Input
          id="phone"
          label="Phone number (optional)"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="082 441 9082"
          value={values.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={errors.phone}
          leadingIcon={<Phone size={18} />}
        />
        <Textarea
          id="message"
          label="Message (optional)"
          rows={3}
          maxLength={500}
          placeholder="Which property or business are you with?"
          value={values.message}
          onChange={(e) => set('message', e.target.value)}
          error={errors.message}
        />
        <Button type="submit" loading={submitting} className="w-full">
          Request Access
        </Button>
        <p className="text-center text-body-md text-on-surface-variant">
          Already have an account?{' '}
          <Link to="/login" className="text-label-md font-medium text-secondary hover:text-primary">
            Sign In
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
