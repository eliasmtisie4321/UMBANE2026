import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '@/App'
import { makeAuth, renderAt, signedInAs } from '@/auth/authTestUtils'

describe('route protection', () => {
  it('redirects signed-out visitors to the login screen', () => {
    renderAt(<App />, makeAuth(), '/customers')
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('shows a spinner, not protected content, while loading', () => {
    renderAt(<App />, makeAuth({ status: 'loading' }), '/customers')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Customers' })).toBeNull()
  })

  it('does not trust a session that has no profile', () => {
    renderAt(<App />, makeAuth({ status: 'authenticated', profile: null }), '/')
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('lets an administrator open any section', () => {
    renderAt(<App />, signedInAs('administrator'), '/settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('blocks staff from admin-only sections but keeps the shell', () => {
    renderAt(<App />, signedInAs('staff'), '/settings')
    expect(screen.getByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('blocks clients from staff areas', () => {
    renderAt(<App />, signedInAs('client'), '/leads')
    expect(screen.getByRole('heading', { name: /do not have access/i })).toBeInTheDocument()
  })

  it('shows each role only the navigation it may use', () => {
    renderAt(<App />, signedInAs('client'), '/')
    expect(screen.getByRole('link', { name: 'Invoices' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Customers' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('navigates within the app without a page reload', async () => {
    renderAt(<App />, signedInAs('manager'), '/')
    await userEvent.click(screen.getByRole('link', { name: 'Customers' }))
    expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
  })

  it('shows the user and signs out from the account menu', async () => {
    const auth = signedInAs('manager')
    renderAt(<App />, auth, '/')
    expect(screen.getByText('Manager')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('shows a not-found page for unknown paths', () => {
    renderAt(<App />, signedInAs('administrator'), '/nope')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
