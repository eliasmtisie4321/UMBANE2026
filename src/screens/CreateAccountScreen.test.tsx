import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAuth, renderAt } from '@/auth/authTestUtils'
import { err, ok } from '@/utils/result'
import App from '@/App'

const requestAccess = vi.hoisted(() => vi.fn())
vi.mock('@/services/accessRequests', () => ({ requestAccess }))

const type = (label: string, value: string) =>
  userEvent.type(screen.getByLabelText(new RegExp(label)), value)
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Request Access' }))

describe('Create account', () => {
  beforeEach(() => {
    requestAccess.mockReset()
    requestAccess.mockResolvedValue(ok(undefined))
  })

  it('is reachable from the login page', async () => {
    renderAt(<App />, makeAuth(), '/login')
    await userEvent.click(screen.getByRole('link', { name: 'Create Account' }))
    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
  })

  it('validates before sending anything', async () => {
    renderAt(<App />, makeAuth(), '/create-account')
    await type('Email address', 'nope')
    await type('Phone number', '123')
    await submit()
    expect(screen.getByText('Enter your full name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText(/Enter a South African number/)).toBeInTheDocument()
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it('sends a normalised request and confirms without revealing anything', async () => {
    renderAt(<App />, makeAuth(), '/create-account')
    await type('Full name', 'Thandi Nkosi')
    await type('Email address', 'thandi@example.co.za')
    await type('Phone number', '082 441 9082')
    await submit()
    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeInTheDocument()
    expect(requestAccess).toHaveBeenCalledWith({
      fullName: 'Thandi Nkosi',
      email: 'thandi@example.co.za',
      phone: '+27824419082',
      message: '',
    })
    expect(screen.getByText(/thandi@example.co.za/)).toBeInTheDocument()
  })

  it('shows the error and keeps what was typed when sending fails', async () => {
    requestAccess.mockResolvedValue(
      err({
        code: 'network',
        message: 'Cannot reach the server. Check your connection and try again.',
      }),
    )
    renderAt(<App />, makeAuth(), '/create-account')
    await type('Full name', 'Thandi Nkosi')
    await type('Email address', 'thandi@example.co.za')
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server')
    expect(screen.getByLabelText('Full name')).toHaveValue('Thandi Nkosi')
  })
})
