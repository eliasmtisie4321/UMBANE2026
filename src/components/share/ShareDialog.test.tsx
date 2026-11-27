import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as messageService from '@/services/messages'
import * as shareService from '@/services/share'
import { connection, shareReady } from '@/test/share'
import type { UserRole } from '@/types/auth'
import type { MessageTemplate } from '@/types/messages'
import { err, ok } from '@/utils/result'
import { ShareDialog, type ShareContext } from './ShareDialog'

vi.mock('@/services/messages')
vi.mock('@/services/share', async (real) => ({
  ...(await real<typeof import('@/services/share')>()),
  ...(await import('@/test/share')).shareMocks(),
}))

const m = vi.mocked(messageService)
const sh = vi.mocked(shareService)

const template = (over: Partial<MessageTemplate> = {}): MessageTemplate => ({
  id: 't1',
  key: 'general',
  name: 'General message',
  purpose: 'transactional',
  subject: 'A message from {{business_name}}',
  body: 'Good day {{customer_name}},\n\n{{message}}',
  isActive: true,
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

const context: ShareContext = {
  title: 'Share invoice INV-2026-00007',
  customer: { id: 'c1', name: 'Naledi Dlamini' },
  invoiceId: 'inv1',
  subject: 'Invoice INV-2026-00007',
  body: 'Your invoice is attached.',
  attachment: {
    label: 'the invoice PDF',
    build: async () => ok({ bytes: new Uint8Array([37]), name: 'INV.pdf' }),
  },
}

const onDone = vi.fn()
function open(
  role: UserRole = 'staff',
  ctx: ShareContext = context,
  mode: 'direct' | 'social' = 'direct',
) {
  return renderAt(
    <ShareDialog context={ctx} mode={mode} onClose={vi.fn()} onDone={onDone} />,
    signedInAs(role),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.listTemplates.mockResolvedValue(ok([template()]))
  m.getBusinessName.mockResolvedValue(ok('Umbane'))
  m.uploadEmailAttachment.mockResolvedValue(ok({ path: 'b1/k/INV.pdf', name: 'INV.pdf' }))
})

describe('choosing where to share', () => {
  it('offers the connected platforms and says how to connect the others', async () => {
    shareReady(sh, { connections: [connection()] })
    open('administrator')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('checkbox', { name: 'Email' })).toBeEnabled()
    expect(within(dialog).getByRole('checkbox', { name: 'SMS' })).toBeEnabled()
    expect(within(dialog).getByText('SMS (Twilio) · +27870000001')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'WhatsApp' })).toBeDisabled()
    expect(
      within(dialog).getByRole('link', { name: 'Connect in Settings → Integrations' }),
    ).toHaveAttribute('href', '/settings/integrations')
  })

  it('tells staff to ask an administrator instead', async () => {
    shareReady(sh)
    open('staff')
    expect(await screen.findAllByText('Ask an administrator to connect it')).toHaveLength(2)
  })

  it('shows what each recipient has on file and what stops a channel', async () => {
    shareReady(sh, {
      connections: [connection()],
      phone: '082 555 0101',
      flags: { smsOptOut: true },
    })
    open('staff')
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'SMS' }))
    expect(within(dialog).getByText('client1@umbane.test · +27825550101')).toBeInTheDocument()
    expect(within(dialog).getByText('SMS: Asked not to receive SMS')).toBeInTheDocument()
  })
})

describe('sending to several platforms at once', () => {
  it('queues one message per platform in the same share, previews each, and reports each result', async () => {
    shareReady(sh, { connections: [connection()], phone: '082 555 0101' })
    sh.getMessageStates.mockResolvedValueOnce(
      ok({
        msg1: { state: 'sent', error: null, externalUrl: null },
        msg2: { state: 'failed', error: 'Twilio 400 21211: Invalid To', externalUrl: null },
      }),
    )
    m.retryMessage.mockResolvedValue(ok(null))
    open('staff')
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'SMS' }))
    const preview = within(dialog).getByRole('region', { name: 'Preview' })
    expect(within(preview).getByRole('article', { name: 'Email preview' })).toHaveTextContent(
      'Attached: the invoice PDF',
    )
    expect(within(preview).getByRole('article', { name: 'SMS preview' })).toHaveTextContent(
      'Private link to the invoice PDF',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))

    expect(
      await within(dialog).findByText('1 of 2 sent. The others are below.'),
    ).toBeInTheDocument()
    const [email, sms] = sh.queueMessage.mock.calls.map((c) => c[0])
    expect(email).toMatchObject({
      channel: 'email',
      integrationId: null,
      recipient: { kind: 'customer', id: 'c1' },
      invoiceId: 'inv1',
      attachment: { path: 'b1/k/INV.pdf' },
    })
    expect(sms).toMatchObject({ channel: 'sms', integrationId: 'int-sms', subject: null })
    expect(email.shareId).toBe(sms.shareId)
    expect(email.idempotencyKey).toBe(`${email.shareId}:email:customer:c1`)
    expect(sms.idempotencyKey).not.toBe(email.idempotencyKey)
    expect(m.uploadEmailAttachment).toHaveBeenCalledTimes(1)
    expect(sh.sendMessages).toHaveBeenCalledWith(['msg1', 'msg2'])
    expect(within(dialog).getByText('Twilio 400 21211: Invalid To')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Try Again' }))
    expect(m.retryMessage).toHaveBeenCalledWith('msg2')
    expect(sh.sendMessages).toHaveBeenLastCalledWith(['msg2'])
    expect(await within(dialog).findAllByText('Sent')).toHaveLength(2)
  })

  it('does not queue a message the recipient cannot get, and says why', async () => {
    shareReady(sh, { connections: [connection()], phone: null })
    open('staff')
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Email' }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'SMS' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText('No mobile number on file')).toBeInTheDocument()
    expect(within(dialog).getByText('Not sent')).toBeInTheDocument()
    expect(sh.queueMessage).not.toHaveBeenCalled()
  })

  it('checks the message before anything is sent', async () => {
    shareReady(sh)
    open('staff', { ...context, body: '', subject: '' })
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(await within(dialog).findByLabelText('Template'), '')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(within(dialog).getByText('Write a message.')).toBeInTheDocument()
    expect(within(dialog).getByText('An email needs a subject.')).toBeInTheDocument()
    expect(sh.queueMessage).not.toHaveBeenCalled()
  })

  it('lets managers add a typed address for service messages', async () => {
    shareReady(sh)
    open('manager', { ...context, allowAddress: true })
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(
      await within(dialog).findByLabelText(/Someone else/),
      'accountant@example.co.za',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByText('Sent.')).toBeInTheDocument()
    expect(sh.queueMessage.mock.calls.map((c) => c[0].recipient)).toEqual([
      { kind: 'customer', id: 'c1', name: 'Naledi Dlamini' },
      { kind: 'address', value: 'accountant@example.co.za' },
    ])
  })

  it('shows a refusal from the database on that destination', async () => {
    shareReady(sh)
    sh.queueMessage.mockResolvedValue(
      err({
        code: 'validation',
        message: 'This person has asked not to receive messages this way.',
      }),
    )
    open('staff')
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send' }))
    expect(
      await within(dialog).findByText('This person has asked not to receive messages this way.'),
    ).toBeInTheDocument()
    expect(sh.sendMessages).toHaveBeenCalledWith([])
  })
})

describe('public posts', () => {
  const social = [
    connection({
      id: 'int-fb',
      provider: 'facebook',
      channel: 'facebook',
      accountLabel: 'Umbane Energy',
      capabilities: ['publish_social'],
    }),
    connection({
      id: 'int-ig',
      provider: 'instagram',
      channel: 'instagram',
      accountLabel: '@umbane',
      capabilities: ['publish_social'],
    }),
  ]

  it('publishes to the chosen pages without any recipient, and needs an image for Instagram', async () => {
    shareReady(sh, { connections: social })
    open('manager', { title: 'New post' }, 'social')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('To')).toBeNull()
    expect(await within(dialog).findByText(/Not available: TikTok/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Instagram' }))
    await userEvent.type(within(dialog).getByLabelText('Post'), 'Smart meters now in Pretoria.')
    await userEvent.type(
      within(dialog).getByLabelText('Link (optional)'),
      'https://umbane.co.za/meters',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    expect(within(dialog).getByText('Instagram posts need an image address.')).toBeInTheDocument()
    expect(sh.queueMessage).not.toHaveBeenCalled()

    await userEvent.type(
      within(dialog).getByLabelText('Image address'),
      'https://umbane.co.za/meter.jpg',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    expect(await within(dialog).findByText('Published.')).toBeInTheDocument()
    expect(sh.queueMessage.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({
        channel: 'facebook',
        integrationId: 'int-fb',
        recipient: null,
        purpose: 'marketing',
        linkUrl: 'https://umbane.co.za/meters',
        imageUrl: 'https://umbane.co.za/meter.jpg',
        invoiceId: null,
      }),
      expect.objectContaining({ channel: 'instagram', integrationId: 'int-ig', recipient: null }),
    ])
  })
})
