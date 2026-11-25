import { describe, expect, it, vi } from 'vitest'
import { requestAccess, type RpcClient } from './accessRequests'

const input = { fullName: ' Thandi Nkosi ', email: ' t@example.co.za ', phone: '', message: '' }
const clientWith = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as RpcClient & {
    rpc: ReturnType<typeof vi.fn>
  }

describe('requestAccess', () => {
  it('calls the database function with trimmed values and nulls for blanks', async () => {
    const client = clientWith({ error: null })
    const result = await requestAccess(input, client)
    expect(result.ok).toBe(true)
    expect(client.rpc).toHaveBeenCalledWith('request_access', {
      p_full_name: 'Thandi Nkosi',
      p_email: 't@example.co.za',
      p_phone: null,
      p_message: null,
    })
  })

  it.each([
    [{ code: '23514', message: 'check' }, 'validation', /not valid/],
    [{ code: 'PGRST202', message: 'missing' }, 'unknown', /not available yet/],
    [{ message: 'TypeError: Failed to fetch' }, 'network', /Cannot reach the server/],
    [{ code: 'XX000', message: 'secret internal detail' }, 'unknown', /Could not send/],
  ])('maps %j to a safe message', async (error, code, text) => {
    const result = await requestAccess(input, clientWith({ error }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(code)
      expect(result.error.message).toMatch(text)
      expect(result.error.message).not.toMatch(/secret/)
    }
  })

  it('turns a thrown error into a network result', async () => {
    const client = { rpc: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as RpcClient
    const result = await requestAccess(input, client)
    expect(result.ok).toBe(false)
  })
})
