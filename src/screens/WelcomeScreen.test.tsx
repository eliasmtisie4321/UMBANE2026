import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '@/App'
import { makeAuth, profileFor, renderAt } from '@/auth/authTestUtils'
import { err } from '@/utils/result'

describe('accepting a team invitation', () => {
  it('welcomes the new member and has them choose a password', async () => {
    const auth = makeAuth({
      status: 'authenticated',
      profile: profileFor('staff', { full_name: 'Nomvula New' }),
    })
    renderAt(<App />, auth, '/welcome')
    expect(await screen.findByRole('heading', { name: 'Welcome, Nomvula New' })).toBeInTheDocument()
    expect(screen.getByText(/joined as Staff/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng!pass')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ng!pass')
    await userEvent.click(screen.getByRole('button', { name: 'Set Password and Continue' }))
    expect(auth.updatePassword).toHaveBeenCalledWith('Str0ng!pass')
  })

  it('refuses a weak password and shows the reason from Supabase', async () => {
    const auth = makeAuth({ status: 'authenticated', profile: profileFor('staff') })
    auth.updatePassword = async () =>
      err({ code: 'validation', message: 'Password is too common.' })
    renderAt(<App />, auth, '/welcome')
    await userEvent.type(await screen.findByLabelText('Password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Set Password and Continue' }))
    expect(
      screen.getByText('Your password does not meet all the requirements.'),
    ).toBeInTheDocument()
  })

  it('explains a link that no longer works', async () => {
    renderAt(<App />, makeAuth(), '/welcome')
    expect(
      await screen.findByRole('heading', { name: 'This invitation link does not work' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login')
  })
})
