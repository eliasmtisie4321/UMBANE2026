import { vi } from 'vitest'
import type * as ShareService from '@/services/share'
import { reachabilityOf } from '@/services/share'
import type { DeliveryState, IntegrationConnection } from '@/types/integrations'
import { ok } from '@/utils/result'

/**
 * For test files that mock the share service like this (pure helpers stay real):
 *
 *   vi.mock('@/services/share', async (real) => ({
 *     ...(await real<typeof import('@/services/share')>()),
 *     ...shareMocks(),
 *   }))
 */
export const shareMocks = () => ({
  listDestinations: vi.fn(),
  getReachability: vi.fn(),
  listTeamRecipients: vi.fn(),
  queueMessage: vi.fn(),
  sendMessages: vi.fn(),
  getMessageStates: vi.fn(),
})

export const connection = (over: Partial<IntegrationConnection> = {}): IntegrationConnection => ({
  id: 'int-sms',
  provider: 'twilio',
  channel: 'sms',
  status: 'connected',
  accountLabel: '+27870000001',
  capabilities: ['direct_message', 'document_links'],
  settings: {},
  isDefault: true,
  connectedAt: '2026-11-01T00:00:00Z',
  lastCheckedAt: null,
  lastError: null,
  webhook: null,
  ...over,
})

type Mocked = ReturnType<typeof vi.mocked<typeof ShareService>>

/** Everything ready: built-in email, the given connections, a reachable recipient, all sent. */
export function shareReady(
  sh: Mocked,
  opts: {
    connections?: IntegrationConnection[]
    builtInEmail?: boolean
    email?: string | null
    phone?: string | null
    flags?: Parameters<typeof reachabilityOf>[1]
    state?: DeliveryState
  } = {},
) {
  sh.listDestinations.mockResolvedValue(
    ok({ connections: opts.connections ?? [], builtInEmail: opts.builtInEmail ?? true }),
  )
  sh.getReachability.mockResolvedValue(
    ok(
      reachabilityOf(
        {
          email: opts.email === undefined ? 'client1@umbane.test' : opts.email,
          phone: opts.phone ?? null,
        },
        { isCustomer: true, whatsappOptIn: true, ...(opts.flags ?? {}) },
      ),
    ),
  )
  sh.listTeamRecipients.mockResolvedValue(ok([]))
  let n = 0
  sh.queueMessage.mockImplementation(async () => ok({ id: `msg${++n}` }))
  sh.sendMessages.mockResolvedValue('sent')
  sh.getMessageStates.mockImplementation(async (ids: string[]) =>
    ok(
      Object.fromEntries(
        ids.map((id) => [id, { state: opts.state ?? 'sent', error: null, externalUrl: null }]),
      ),
    ),
  )
}
