import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as integrationService from '@/services/integrations'
import * as notificationService from '@/services/notifications'
import { connection } from '@/test/share'
import type { UserRole } from '@/types/auth'
import type { IntegrationsOverview } from '@/types/integrations'
import { err, ok } from '@/utils/result'
import { navigation } from '@/utils/browser'

vi.mock('@/services/integrations', async (real) => ({
  ...(await real<typeof import('@/services/integrations')>()),
  getIntegrations: vi.fn(),
  connectWithKeys: vi.fn(),
  startOAuth: vi.fn(),
  testIntegration: vi.fn(),
  updateIntegrationSettings: vi.fn(),
  setDefaultIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
}))
vi.mock('@/services/notifications')

const s = vi.mocked(integrationService)

const overview = (over: Partial<IntegrationsOverview> = {}): IntegrationsOverview => ({
  providers: [
    { key: 'resend', ready: true, missing: [] },
    { key: 'google', ready: true, missing: [] },
    { key: 'microsoft', ready: false, missing: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'] },
    { key: 'twilio', ready: true, missing: [] },
    { key: 'whatsapp', ready: true, missing: [] },
    { key: 'facebook', ready: true, missing: [] },
    { key: 'instagram', ready: true, missing: [] },
    { key: 'linkedin', ready: true, missing: [] },
    { key: 'tiktok', ready: false, missing: [] },
  ],
  connections: [
    connection({
      id: 'r1',
      provider: 'resend',
      channel: 'email',
      accountLabel: 'accounts@umbane.co.za',
      capabilities: ['send_email', 'attachments', 'delivery_tracking'],
      webhook: { url: 'https://crm/api/webhooks/resend?integration=r1' },
    }),
    connection({
      id: 't1',
      provider: 'twilio',
      status: 'error',
      isDefault: false,
      lastError: 'Twilio refused the credentials (401). Connect it again.',
    }),
  ],
  builtInEmail: { ready: false, from: null },
  redirectUri: 'https://crm.umbane.test/api/integrations/callback',
  ...over,
})

const open = (role: UserRole = 'administrator', route = '/settings/integrations') =>
  renderAt(<App />, signedInAs(role), route)
const card = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('li') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  s.getIntegrations.mockResolvedValue(ok(overview()))
})

describe('Settings → Integrations', () => {
  it('shows every provider with what it is connected as and what it can do', async () => {
    open()
    const resend = await card('Resend')
    expect(within(resend).getByText('Connected')).toBeInTheDocument()
    expect(within(resend).getByText('Default for Email')).toBeInTheDocument()
    expect(within(resend).getByText('accounts@umbane.co.za')).toBeInTheDocument()
    expect(
      within(within(resend).getByRole('list', { name: 'What it can do' })).getAllByRole('listitem'),
    ).toHaveLength(3)
    expect(
      within(resend).getByText('https://crm/api/webhooks/resend?integration=r1'),
    ).toBeInTheDocument()

    const twilio = await card('SMS (Twilio)')
    expect(within(twilio).getByText('Needs attention')).toBeInTheDocument()
    expect(within(twilio).getByText(/refused the credentials/)).toBeInTheDocument()

    const microsoft = await card('Outlook / Microsoft 365')
    expect(within(microsoft).getByText('Server setup needed')).toBeInTheDocument()
    expect(
      within(microsoft).getByText('MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET'),
    ).toBeInTheDocument()
    expect(within(microsoft).getByRole('button', { name: 'Connect' })).toBeDisabled()

    const tiktok = await card('TikTok')
    expect(within(tiktok).getByText('Not available')).toBeInTheDocument()
    expect(within(tiktok).queryByRole('button')).toBeNull()
    expect(screen.getByText(/Not set up on the server/)).toBeInTheDocument()
  })

  it('connects with keys only after the provider confirms them', async () => {
    s.connectWithKeys.mockResolvedValueOnce(
      Object.assign(
        err({ code: 'validation', message: 'Meta refused the phone number ID or token.' }),
        {},
      ),
    )
    open()
    await userEvent.click(
      within(await card('WhatsApp Business')).getByRole('button', { name: 'Connect' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Connect WhatsApp Business' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check and Connect' }))
    expect(within(dialog).getByText('Enter the phone number id.')).toBeInTheDocument()
    expect(s.connectWithKeys).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText('Phone number ID'), '1234567890')
    await userEvent.type(within(dialog).getByLabelText('Access token'), 'EAAG' + 'a'.repeat(60))
    expect(within(dialog).getByLabelText('Access token')).toHaveAttribute('type', 'password')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check and Connect' }))
    expect(
      await within(dialog).findByText('Meta refused the phone number ID or token.'),
    ).toBeInTheDocument()
    expect(s.connectWithKeys).toHaveBeenCalledWith(
      'whatsapp',
      { phoneNumberId: '1234567890', accessToken: 'EAAG' + 'a'.repeat(60) },
      {},
    )

    s.connectWithKeys.mockResolvedValueOnce(
      ok({
        connection: connection({
          provider: 'whatsapp',
          channel: 'whatsapp',
          accountLabel: 'Umbane (+27 87 000 0001)',
        }),
      }),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check and Connect' }))
    expect(
      await screen.findByText('WhatsApp Business is connected as Umbane (+27 87 000 0001).'),
    ).toBeInTheDocument()
  })

  it('sends the administrator to the provider to sign in', async () => {
    const go = vi.spyOn(navigation, 'go').mockImplementation(() => undefined)
    s.startOAuth.mockResolvedValue(
      ok({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' }),
    )
    open()
    await userEvent.click(
      within(await card('Gmail / Google Workspace')).getByRole('button', { name: 'Connect' }),
    )
    expect(s.startOAuth).toHaveBeenCalledWith('google')
    expect(go).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=x')
  })

  it('says what happened when the provider sends them back', async () => {
    open(
      'administrator',
      '/settings/integrations?error=verify&provider=google&reason=Permission%20to%20send%20email%20was%20not%20granted.',
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gmail / Google Workspace was not connected: Permission to send email was not granted.',
    )
  })

  it('tests a connection and sends a test email', async () => {
    s.testIntegration.mockResolvedValue(
      ok({ connection: connection(), testEmail: { sent: true, to: 'test@umbane.test' } }),
    )
    open()
    await userEvent.click(
      within(await card('Resend')).getByRole('button', { name: 'Send Test Email' }),
    )
    expect(s.testIntegration).toHaveBeenCalledWith('r1', true)
    expect(
      await screen.findByText('Resend works. A test email was sent to test@umbane.test.'),
    ).toBeInTheDocument()
  })

  it('disconnects after confirming', async () => {
    s.disconnectIntegration.mockResolvedValue(ok({ disconnected: true }))
    open()
    await userEvent.click(within(await card('Resend')).getByRole('button', { name: 'Disconnect' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Resend?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    expect(s.disconnectIntegration).toHaveBeenCalledWith('r1')
    expect(await screen.findByText('Resend is disconnected.')).toBeInTheDocument()
  })

  it('is for administrators only', async () => {
    open('manager')
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument()
    expect(s.getIntegrations).not.toHaveBeenCalled()
  })
})
