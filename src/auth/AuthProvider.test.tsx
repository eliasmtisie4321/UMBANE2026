import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthClient } from '@/services/auth'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

type Listener = (event: string, session: unknown) => void

const session = { user: { id: 'u1' } }
const profileRow = {
  id: 'u1',
  business_id: 'b1',
  role: 'staff',
  full_name: 'Sam',
  email: 's@x.co',
  is_active: true,
}

function fakeClient(opts: { session: unknown; profile: unknown }) {
  let listener: Listener = () => {}
  const signOut = vi.fn().mockImplementation(async () => {
    listener('SIGNED_OUT', null)
    return { error: null }
  })
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: opts.session } }),
      onAuthStateChange: vi.fn((cb: Listener) => {
        listener = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signOut,
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.profile, error: null }) }),
      }),
    }),
  } as unknown as AuthClient
  return { client, emit: (e: string, s: unknown) => listener(e, s), signOut }
}

function Probe() {
  const a = useAuth()
  return (
    <div>
      <p data-testid="status">{a.status}</p>
      <p data-testid="role">{a.profile?.role ?? '-'}</p>
      <p data-testid="expired">{String(a.sessionExpired)}</p>
      <p data-testid="access">{a.accessError ?? '-'}</p>
      <button onClick={() => void a.signOut()}>out</button>
    </div>
  )
}

const mount = (client: AuthClient) =>
  render(
    <AuthProvider client={client}>
      <Probe />
    </AuthProvider>,
  )

describe('AuthProvider', () => {
  it('is unauthenticated with no stored session', async () => {
    mount(fakeClient({ session: null, profile: null }).client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
  })

  it('restores a stored session and loads the profile', async () => {
    mount(fakeClient({ session, profile: profileRow }).client)
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('role')).toHaveTextContent('staff')
  })

  it('flags an expired session when the session ends without a manual sign out', async () => {
    const { client, emit } = fakeClient({ session, profile: profileRow })
    mount(client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    act(() => emit('SIGNED_OUT', null))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('expired')).toHaveTextContent('true')
  })

  it('does not flag expiry when the user signs out themselves', async () => {
    const { client } = fakeClient({ session, profile: profileRow })
    mount(client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    await act(async () => screen.getByText('out').click())
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('expired')).toHaveTextContent('false')
  })

  it('turns away a user with no profile and signs them out', async () => {
    const { client, signOut } = fakeClient({ session, profile: null })
    mount(client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('access')).toHaveTextContent(/not been set up/i)
    expect(signOut).toHaveBeenCalled()
    expect(screen.getByTestId('expired')).toHaveTextContent('false')
  })

  it('turns away a deactivated user', async () => {
    const { client } = fakeClient({ session, profile: { ...profileRow, is_active: false } })
    mount(client)
    await waitFor(() => expect(screen.getByTestId('access')).toHaveTextContent(/deactivated/i))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })
})
