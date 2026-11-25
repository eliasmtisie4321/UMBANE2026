import { describe, expect, it } from 'vitest'
import { describeActivity } from './activity'

const entry = (over: Partial<Parameters<typeof describeActivity>[0]>) => ({
  id: '1',
  action: 'INSERT',
  table: 'payments',
  actorName: 'Sam Staff',
  createdAt: '2026-11-10T10:00:00Z',
  ...over,
})

describe('describeActivity', () => {
  it('writes a plain sentence', () => {
    expect(describeActivity(entry({}))).toBe('Sam Staff created a payment')
    expect(describeActivity(entry({ action: 'UPDATE', table: 'invoices' }))).toBe(
      'Sam Staff updated an invoice',
    )
    expect(describeActivity(entry({ action: 'DELETE', table: 'customers' }))).toBe(
      'Sam Staff deleted a customer',
    )
  })
  it('handles a missing actor and unknown tables', () => {
    expect(describeActivity(entry({ actorName: null }))).toBe('The system created a payment')
    expect(describeActivity(entry({ table: 'ticket_messages' }))).toBe(
      'Sam Staff created a ticket messages record',
    )
    expect(describeActivity(entry({ table: null }))).toBe('Sam Staff created a record')
  })
})
