import { describe, expect, it, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import type { ListQuery } from '@/types/customers'
import type { TicketSort } from '@/types/support'
import { getUnreadCount, listNotifications, markRead } from './notifications'
import {
  assignTicket,
  attachmentUrls,
  createTicket,
  getTicket,
  getTicketAssets,
  getTicketCounts,
  listTickets,
  postMessage,
  setTicketStatus,
  uploadAttachment,
  type StorageApi,
} from './support'

const query: ListQuery<TicketSort> = {
  search: '',
  sort: 'created_at',
  ascending: false,
  page: 1,
  pageSize: 25,
}
const none = { status: '', category: '', priority: '', assignee: '' } as const

function fakeStorage(reply: { error?: { message: string } | null } = {}) {
  const upload = vi.fn().mockResolvedValue({ data: {}, error: reply.error ?? null })
  const createSignedUrls = vi.fn().mockResolvedValue({
    data: [
      { path: 'a', signedUrl: 'https://x/a', error: null },
      { path: 'b', signedUrl: '', error: 'Not found' },
    ],
    error: null,
  })
  const from = vi.fn(() => ({ upload, createSignedUrls }))
  return { storage: { from } as unknown as StorageApi, from, upload, createSignedUrls }
}

describe('ticket list', () => {
  it('filters active tickets, unassigned ones and by category and priority', async () => {
    const { client, log } = fake({ ticket_list: { data: [], count: 0 } })
    await listTickets(
      query,
      { status: 'active', category: 'billing', priority: 'urgent', assignee: 'unassigned' },
      client,
    )
    for (const op of [
      'eq("is_open",true)',
      'eq("category","billing")',
      'eq("priority","urgent")',
      'is("assigned_to",null)',
      'order("created_at",{"ascending":false})',
    ])
      expect(log[0].ops).toContain(op)
  })

  it('filters one status, one person, and searches reference, subject and customer', async () => {
    const { client, log } = fake({ ticket_list: { data: [], count: 0 } })
    await listTickets(
      { ...query, search: 'E-04' },
      { ...none, status: 'resolved', assignee: 's1' },
      client,
    )
    expect(log[0].ops).toContain('eq("status","resolved")')
    expect(log[0].ops).toContain('eq("assigned_to","s1")')
    expect(log[0].ops.join()).toMatch(/reference\.ilike.*subject\.ilike.*customer_name\.ilike/)
  })

  it('maps rows, keeping an assignee a client cannot see as unknown', async () => {
    const { client } = fake({
      ticket_list: {
        data: [
          {
            id: 't1',
            reference: 'TKT-2026-00001',
            subject: 'No power',
            category: 'meter_fault',
            status: 'assigned',
            priority: 'urgent',
            customer_id: 'c1',
            customer_name: 'Cleo',
            property_name: null,
            assigned_to: 's1',
            assignee_name: null,
            created_at: 'a',
            last_activity_at: 'b',
            message_count: 2,
            attachment_count: '1',
          },
        ],
        count: 1,
      },
    })
    const r = await listTickets(query, none, client)
    expect(r.ok && r.data.rows[0]).toMatchObject({
      assignedTo: 's1',
      assigneeName: null,
      attachmentCount: 1,
    })
  })

  it('shows zeros before any ticket exists', async () => {
    const r = await getTicketCounts(fake({ ticket_summary: { data: null } }).client)
    expect(r.ok && r.data).toEqual({
      total: 0,
      open: 0,
      assigned: 0,
      inProgress: 0,
      resolved: 0,
      closed: 0,
      urgentOpen: 0,
    })
  })

  it('treats a malformed or missing ticket as not found', async () => {
    const bad = await getTicket('x', fake({ ticket_list: { error: { code: '22P02' } } }).client)
    expect(bad.ok ? null : bad.error.code).toBe('not_found')
    const gone = await getTicket('x', fake({ ticket_list: { data: null } }).client)
    expect(gone.ok ? null : gone.error.code).toBe('not_found')
  })
})

describe('opening and working tickets', () => {
  const input = {
    customerId: null,
    subject: 'No power',
    description: 'E-04',
    category: 'meter_fault' as const,
    propertyId: null,
    meterId: 'm1',
  }

  it('lets the database choose the customer and reference for a client', async () => {
    const { client, log } = fake({
      support_tickets: { data: { id: 't1', reference: 'TKT-2026-00001' } },
    })
    const r = await createTicket(input, client)
    expect(r.ok && r.data.reference).toBe('TKT-2026-00001')
    expect(log[0].ops[0]).toBe(
      'insert({"subject":"No power","description":"E-04","category":"meter_fault","property_id":null,"meter_id":"m1"})',
    )
  })

  it('sends the customer, priority and assignee for staff', async () => {
    const { client, log } = fake({ support_tickets: { data: { id: 't1', reference: 'R' } } })
    await createTicket({ ...input, customerId: 'c1', priority: 'high', assignedTo: 's1' }, client)
    expect(log[0].ops[0]).toContain('"priority":"high"')
    expect(log[0].ops[0]).toContain('"customer_id":"c1"')
    expect(log[0].ops[0]).toContain('"assigned_to":"s1"')
  })

  it.each([
    ['ticket_meter_mismatch', 'meterId', /not at this customer/],
    ['ticket_description_required', 'description', /Describe/],
    ['assignee_not_staff', 'assignedTo', /team member/],
  ])('explains %s on its field', async (message, field, text) => {
    const r = await createTicket(
      input,
      fake({ support_tickets: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? null : r.error.field).toBe(field)
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('assigns with a priority, and unassigns with null', async () => {
    const { client, log } = fake({ support_tickets: { data: [{ id: 't1' }] } })
    await assignTicket('t1', null, 'urgent', client)
    expect(log[0].ops[0]).toBe('update({"assigned_to":null,"priority":"urgent"})')
  })

  it('sends a resolution only with Resolved or Closed', async () => {
    const { client, log } = fake({ support_tickets: { data: [{ id: 't1' }] } })
    await setTicketStatus('t1', 'resolved', ' Re-terminated the lug ', client)
    await setTicketStatus('t1', 'in_progress', null, client)
    expect(log[0].ops[0]).toBe('update({"status":"resolved","resolution":"Re-terminated the lug"})')
    expect(log[1].ops[0]).toBe('update({"status":"in_progress"})')
  })

  it('says so when a change matched nothing the person may change', async () => {
    const r = await setTicketStatus(
      't1',
      'closed',
      'x',
      fake({ support_tickets: { data: [] } }).client,
    )
    expect(r.ok ? null : r.error.code).toBe('forbidden')
  })

  it.each([
    ['ticket_closed', /closed/],
    ['ticket_resolution_required', /what was done/],
    ['ticket_needs_assignee', /Assign/],
  ])('explains %s', async (message, text) => {
    const r = await setTicketStatus(
      't1',
      'resolved',
      null,
      fake({ support_tickets: { error: { code: '23514', message } } }).client,
    )
    expect(r.ok ? '' : r.error.message).toMatch(text)
  })

  it('never sends the author: the database takes the person signed in', async () => {
    const { client, log } = fake({ ticket_messages: { data: { id: 'm1' } } })
    await postMessage('t1', ' On my way ', true, client)
    expect(log[0].ops[0]).toBe('insert({"ticket_id":"t1","body":"On my way","is_internal":true})')
  })

  it('loads a customer’s properties with their meters, or the client’s own', async () => {
    const staff = fake({
      properties: {
        data: [
          {
            id: 'p1',
            name: null,
            address: '12 Long St',
            electricity_meters: [{ id: 'm1', serial_number: 'MTR-1' }],
          },
        ],
      },
    })
    const r = await getTicketAssets('c1', staff.client)
    expect(staff.log[0].ops).toContain('eq("customer_id","c1")')
    expect(r.ok && r.data).toEqual([
      { id: 'p1', name: '12 Long St', meters: [{ id: 'm1', serialNumber: 'MTR-1' }] },
    ])
    const own = fake({ properties: { data: [] } })
    await getTicketAssets(null, own.client)
    expect(own.log[0].ops.join()).not.toContain('customer_id')
  })
})

describe('attachments', () => {
  const ticket = { id: 't1', businessId: 'b1' }

  it('uploads under business/ticket with the type from the name, then records it', async () => {
    const s = fakeStorage()
    const { client, log } = fake({ ticket_attachments: { data: { id: 'a1' } } })
    const f = new File(['x,y'], 'Readings Oct.csv', { type: 'application/vnd.ms-excel' })
    const r = await uploadAttachment(ticket, f, { client, storage: s.storage })
    expect(r.ok).toBe(true)
    expect(s.from).toHaveBeenCalledWith('ticket-attachments')
    const [path, body, options] = s.upload.mock.calls[0]
    expect(path).toMatch(/^b1\/t1\/[^/]+-Readings_Oct\.csv$/)
    expect(body).toBe(f)
    expect(options).toEqual({ contentType: 'text/csv', upsert: false })
    expect(log[0].ops[0]).toContain(`"storage_path":"${path}"`)
    expect(log[0].ops[0]).toContain('"file_name":"Readings Oct.csv"')
  })

  it('refuses an unsupported file without uploading it', async () => {
    const s = fakeStorage()
    const r = await uploadAttachment(ticket, new File(['x'], 'tool.exe'), { storage: s.storage })
    expect(r.ok).toBe(false)
    expect(s.upload).not.toHaveBeenCalled()
  })

  it('does not record a file whose upload failed', async () => {
    const s = fakeStorage({ error: { message: 'mime type not supported' } })
    const { client, log } = fake({})
    const r = await uploadAttachment(ticket, new File(['x'], 'a.jpg'), {
      client,
      storage: s.storage,
    })
    expect(r.ok ? '' : r.error.message).toMatch(/a\.jpg could not be uploaded/)
    expect(log).toHaveLength(0)
  })

  it('explains a file the database refused', async () => {
    const s = fakeStorage()
    const r = await uploadAttachment(ticket, new File(['x'], 'a.jpg'), {
      client: fake({
        ticket_attachments: { error: { code: '23514', message: 'ticket_attachment_limit' } },
      }).client,
      storage: s.storage,
    })
    expect(r.ok ? '' : r.error.message).toMatch(/at most 20 files/)
  })

  it('makes private links and leaves out files that could not be signed', async () => {
    const s = fakeStorage()
    const r = await attachmentUrls(['a', 'b'], s.storage)
    expect(r.ok && r.data).toEqual({ a: 'https://x/a' })
    expect(s.createSignedUrls).toHaveBeenCalledWith(['a', 'b'], 3600)
    expect((await attachmentUrls([], s.storage)).ok).toBe(true)
  })
})

describe('notifications', () => {
  it('lists unread ones newest first and ignores links that leave the app', async () => {
    const { client, log } = fake({
      notifications: {
        data: [
          {
            id: 'n1',
            title: 'A',
            body: null,
            link: '/support-tickets/t1',
            is_read: false,
            created_at: 'x',
          },
          {
            id: 'n2',
            title: 'B',
            body: 'b',
            link: 'https://evil.test',
            is_read: false,
            created_at: 'y',
          },
        ],
      },
    })
    const r = await listNotifications(true, client)
    expect(log[0].ops).toContain('eq("is_read",false)')
    expect(log[0].ops).toContain('order("created_at",{"ascending":false})')
    expect(r.ok && r.data.map((n) => n.link)).toEqual(['/support-tickets/t1', null])
  })

  it('counts unread and marks one or all as read', async () => {
    const counted = await getUnreadCount(fake({ notifications: { count: 3 } }).client)
    expect(counted.ok && counted.data).toBe(3)
    const one = fake({ notifications: {} })
    await markRead(['n1'], one.client)
    expect(one.log[0].ops).toContain('in("id",["n1"])')
    const all = fake({ notifications: {} })
    await markRead('all', all.client)
    expect(all.log[0].ops.join()).not.toContain('in(')
    expect(all.log[0].ops[0]).toBe('update({"is_read":true})')
  })
})
