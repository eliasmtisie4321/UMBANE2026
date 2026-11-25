import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeAuth, renderAt, signedInAs } from '@/auth/authTestUtils'
import { err, ok } from '@/utils/result'
import App from '@/App'

const fill = async (email: string, password: string) => {
  if (email) await userEvent.type(screen.getByLabelText('Email address'), email)
  if (password) await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))
}

describe('LoginScreen', () => {
  it('validates before calling the server', async () => {
    const auth = makeAuth()
    renderAt(<App />, auth, '/login')
    await fill('not-an-email', '')
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('submits valid credentials', async () => {
    const auth = makeAuth()
    renderAt(<App />, auth, '/login')
    await fill('a@umbane.test', 'secret')
    expect(auth.signIn).toHaveBeenCalledWith('a@umbane.test', 'secret')
  })

  it('shows the server error message', async () => {
    const signIn = vi
      .fn()
      .mockResolvedValue(err({ code: 'unauthenticated', message: 'Incorrect email or password.' }))
    renderAt(<App />, makeAuth({ signIn }), '/login')
    await fill('a@umbane.test', 'wrong')
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    renderAt(<App />, makeAuth(), '/login')
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
  })

  it('tells the user when their session expired', () => {
    renderAt(<App />, makeAuth({ sessionExpired: true }), '/login')
    expect(screen.getByRole('alert')).toHaveTextContent('Your session expired')
  })

  it('shows why access was refused', () => {
    renderAt(
      <App />,
      makeAuth({ accessError: 'Your account has been deactivated. Contact an administrator.' }),
      '/login',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('deactivated')
  })

  it('explains missing configuration and blocks sign in', () => {
    renderAt(
      <App />,
      makeAuth({ configError: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.' }),
      '/login',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Missing VITE_SUPABASE_URL')
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled()
  })

  it('shows a spinner while the session is loading', () => {
    renderAt(<App />, makeAuth({ status: 'loading' }), '/login')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).toBeNull()
  })

  it('sends an already signed-in user to the app', () => {
    renderAt(<App />, signedInAs('staff'), '/login')
    expect(screen.getByRole('heading', { name: /welcome, test/i })).toBeInTheDocument()
  })
})

describe('ForgotPasswordScreen', () => {
  it('requests a reset and shows the same confirmation for any address', async () => {
    const auth = makeAuth()
    renderAt(<App />, auth, '/forgot-password')
    await userEvent.type(screen.getByLabelText('Email address'), 'who@ever.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }))
    await waitFor(() => expect(auth.requestPasswordReset).toHaveBeenCalledWith('who@ever.test'))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
  })

  it('rejects an invalid email', async () => {
    const auth = makeAuth()
    renderAt(<App />, auth, '/forgot-password')
    await userEvent.type(screen.getByLabelText('Email address'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(auth.requestPasswordReset).not.toHaveBeenCalled()
  })
})

describe('ResetPasswordScreen', () => {
  it('rejects an invalid or expired link (no recovery session)', () => {
    renderAt(<App />, makeAuth(), '/reset-password')
    expect(screen.getByRole('heading', { name: 'This link is not valid' })).toBeInTheDocument()
  })

  it('enforces the password rules and matching confirmation', async () => {
    const auth = signedInAs('staff')
    renderAt(<App />, auth, '/reset-password')
    await userEvent.type(screen.getByLabelText('New password'), 'weak')
    await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }))
    expect(
      screen.getByText('Your password does not meet all the requirements.'),
    ).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.type(screen.getByLabelText('New password'), 'Str0ng!Pass')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different1!')
    await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }))
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument()
    expect(auth.updatePassword).not.toHaveBeenCalled()
  })

  it('updates the password, signs out and returns to login', async () => {
    const auth = signedInAs('staff')
    auth.updatePassword = vi.fn().mockResolvedValue(ok(undefined))
    renderAt(<App />, auth, '/reset-password')
    await userEvent.type(screen.getByLabelText('New password'), 'Str0ng!Pass')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ng!Pass')
    await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }))
    await waitFor(() => expect(auth.updatePassword).toHaveBeenCalledWith('Str0ng!Pass'))
    expect(auth.signOut).toHaveBeenCalled()
  })
})
