import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { renderAt, signedInAs } from '@/auth/authTestUtils'
import * as marketingService from '@/services/marketing'
import * as notificationService from '@/services/notifications'
import * as messageService from '@/services/messages'
import * as shareService from '@/services/share'
import { connection, shareReady } from '@/test/share'
import { ok } from '@/utils/result'

vi.mock('@/services/marketing')
vi.mock('@/services/messages')
vi.mock('@/services/notifications')
vi.mock('@/services/share', async (real) => ({
  ...(await real<typeof import('@/services/share')>()),
  ...(await import('@/test/share')).shareMocks(),
}))

const mk = vi.mocked(marketingService)
const sh = vi.mocked(shareService)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(notificationService.getUnreadCount).mockResolvedValue(ok(0))
  vi.mocked(messageService).getBusinessName.mockResolvedValue(ok('Umbane'))
  mk.listSocialPosts.mockResolvedValue(
    ok([
      {
        id: 'p1',
        channel: 'facebook',
        status: 'sent',
        body: 'Smart meters now in Pretoria.',
        sender: 'Umbane Energy',
        externalUrl: 'https://www.facebook.com/1_2',
        error: null,
        createdAt: '2026-11-20T08:00:00Z',
      },
      {
        id: 'p2',
        channel: 'linkedin',
        status: 'failed',
        body: 'We are hiring.',
        sender: 'Thandi Admin',
        externalUrl: null,
        error: 'LinkedIn 401: token expired',
        createdAt: '2026-11-21T08:00:00Z',
      },
    ]),
  )
})

describe('Marketing', () => {
  it('lists the posts with where they went and how they did', async () => {
    renderAt(<App />, signedInAs('manager'), '/marketing')
    expect(await screen.findByText('Smart meters now in Pretoria.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the post on Facebook' })).toHaveAttribute(
      'href',
      'https://www.facebook.com/1_2',
    )
    expect(screen.getByText('LinkedIn 401: token expired')).toBeInTheDocument()
  })

  it('publishes a new post through the social share dialog', async () => {
    shareReady(sh, {
      connections: [
        connection({
          id: 'fb',
          provider: 'facebook',
          channel: 'facebook',
          accountLabel: 'Umbane Energy',
          capabilities: ['publish_social'],
        }),
      ],
    })
    renderAt(<App />, signedInAs('manager'), '/marketing')
    await userEvent.click(await screen.findByRole('button', { name: /New Post/ }))
    const dialog = screen.getByRole('dialog', { name: 'New post' })
    await userEvent.type(
      await within(dialog).findByLabelText('Post'),
      'Winter tips: switch geysers to a timer.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    expect(await within(dialog).findByText('Published.')).toBeInTheDocument()
    expect(sh.queueMessage.mock.calls[0][0]).toMatchObject({
      channel: 'facebook',
      recipient: null,
      purpose: 'marketing',
    })
  })

  it('is for managers and administrators', async () => {
    renderAt(<App />, signedInAs('staff'), '/marketing')
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument()
  })
})
