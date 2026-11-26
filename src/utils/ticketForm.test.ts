import { describe, expect, it } from 'vitest'
import {
  checkFiles,
  describeEvent,
  emptyTicketForm,
  fileTypeOf,
  formatBytes,
  nextStatuses,
  safeFileName,
  toTicketInput,
  validateMessage,
  validateResolution,
  validateTicketForm,
} from './ticketForm'

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name)

describe('attachments', () => {
  it('decides the type from the name, not the browser', () => {
    expect(fileTypeOf('Readings.CSV')).toBe('text/csv')
    expect(fileTypeOf('meter.jpeg')).toBe('image/jpeg')
    expect(fileTypeOf('report.pdf')).toBe('application/pdf')
    for (const bad of ['setup.exe', 'archive.zip', 'photo.heic', 'noextension', 'doc.docx'])
      expect(fileTypeOf(bad)).toBeNull()
  })

  it('keeps acceptable files and explains each refused one', () => {
    const big = file('big.pdf')
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    const r = checkFiles([file('a.jpg'), file('virus.exe'), file('empty.png', 0), big], 0)
    expect(r.accepted.map((f) => f.name)).toEqual(['a.jpg'])
    expect(r.problems).toEqual([
      'virus.exe: this type of file cannot be attached.',
      'empty.png: the file is empty.',
      'big.pdf: larger than 10 MB.',
    ])
  })

  it('accepts exactly 10 MB and stops at 20 files per ticket', () => {
    const edge = file('edge.pdf')
    Object.defineProperty(edge, 'size', { value: 10 * 1024 * 1024 })
    expect(checkFiles([edge], 0).accepted).toHaveLength(1)
    const r = checkFiles([file('19.jpg'), file('20.jpg'), file('21.jpg')], 18)
    expect(r.accepted.map((f) => f.name)).toEqual(['19.jpg', '20.jpg'])
    expect(r.problems[0]).toMatch(/at most 20 files/)
  })

  it('makes storage-safe names that keep the extension', () => {
    expect(safeFileName('DB-04 breaker (phase B).JPG')).toBe('DB-04_breaker_phase_B.jpg')
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd')
    expect(safeFileName('ñandú.pdf')).toBe('nandu.pdf')
    expect(safeFileName('.pdf')).toBe('pdf')
    expect(safeFileName(`${'x'.repeat(200)}.png`)).toHaveLength(74)
  })

  it('writes sizes people can read', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})

describe('ticket form', () => {
  const good = {
    ...emptyTicketForm,
    subject: ' No power ',
    description: ' E-04 ',
    category: 'meter_fault' as const,
  }

  it('needs a title, category and description, and a customer from staff', () => {
    expect(
      Object.keys(validateTicketForm(emptyTicketForm, { needsCustomer: true })).sort(),
    ).toEqual(['category', 'customerId', 'description', 'subject'])
    expect(validateTicketForm(good, { needsCustomer: false })).toEqual({})
    expect(
      validateTicketForm({ ...good, subject: 'x'.repeat(151) }, { needsCustomer: false }).subject,
    ).toMatch(/150/)
  })

  it('sends a client only the problem, and staff the customer, priority and assignee', () => {
    const v = {
      ...good,
      customerId: 'c1',
      priority: 'urgent' as const,
      assignedTo: 's1',
      meterId: 'm1',
    }
    expect(toTicketInput(v, false)).toEqual({
      customerId: null,
      subject: 'No power',
      description: 'E-04',
      category: 'meter_fault',
      propertyId: null,
      meterId: 'm1',
    })
    expect(toTicketInput(v, true)).toMatchObject({
      customerId: 'c1',
      priority: 'urgent',
      assignedTo: 's1',
    })
  })

  it('checks messages', () => {
    expect(validateMessage('  ')).toMatch(/Write/)
    expect(validateMessage('x'.repeat(5001))).toMatch(/5000/)
    expect(validateMessage('Thanks')).toBeNull()
  })
})

describe('status changes', () => {
  it('offers only the moves the database allows', () => {
    expect(nextStatuses('open', false)).toEqual(['resolved', 'closed'])
    expect(nextStatuses('assigned', true)).toEqual(['in_progress', 'resolved', 'closed'])
    expect(nextStatuses('resolved', true)).toEqual(['assigned', 'in_progress', 'closed'])
    expect(nextStatuses('resolved', false)).toEqual(['open', 'closed'])
    expect(nextStatuses('closed', true)).toEqual([])
  })

  it('needs a resolution to resolve or close', () => {
    expect(validateResolution('resolved', ' ')).toMatch(/what was done/)
    expect(validateResolution('closed', 'Duplicate of TKT-2026-00012')).toBeNull()
    expect(validateResolution('in_progress', '')).toBeNull()
    expect(validateResolution('resolved', 'x'.repeat(2001))).toMatch(/2000/)
  })

  it('describes history in words', () => {
    const e = { id: '1', fromValue: null, toValue: null, actorName: 'Sam', createdAt: 'x' }
    expect(describeEvent({ ...e, kind: 'status', toValue: 'in_progress' })).toBe(
      'Status changed to In Progress',
    )
    expect(describeEvent({ ...e, kind: 'assigned', toValue: 'Sam Staff' })).toBe(
      'Assigned to Sam Staff',
    )
    expect(describeEvent({ ...e, kind: 'assigned' })).toBe('Unassigned')
    expect(describeEvent({ ...e, kind: 'priority', fromValue: 'normal', toValue: 'urgent' })).toBe(
      'Priority changed from Normal to Urgent',
    )
    expect(describeEvent({ ...e, kind: 'attachment', toValue: 'meter.jpg' })).toBe(
      'File attached: meter.jpg',
    )
  })
})
