import { describe, expect, it } from 'vitest'
import { nextSort, pageCount, patchParams, readEnum, readPage, readSort } from './listParams'

const p = (q: string) => new URLSearchParams(q)

describe('readPage', () => {
  it('reads a valid page and defaults otherwise', () => {
    expect(readPage(p('page=3'))).toBe(3)
    for (const bad of ['', 'page=0', 'page=-1', 'page=2.5', 'page=abc', 'page=99999999']) {
      expect(readPage(p(bad))).toBe(1)
    }
  })
})

describe('readEnum', () => {
  it('only accepts allowed values', () => {
    expect(readEnum(p('status=active'), 'status', ['active', 'inactive'] as const)).toBe('active')
    expect(readEnum(p('status=hacked'), 'status', ['active', 'inactive'] as const)).toBe('')
    expect(readEnum(p(''), 'status', ['active'] as const)).toBe('')
  })
})

describe('readSort', () => {
  const allowed = ['name', 'created_at'] as const
  it('reads column and direction', () => {
    expect(readSort(p('sort=created_at&dir=desc'), allowed, 'name')).toEqual({
      sort: 'created_at',
      ascending: false,
    })
    expect(readSort(p('sort=created_at'), allowed, 'name')).toEqual({
      sort: 'created_at',
      ascending: true,
    })
  })
  it('never lets an unknown column reach a query', () => {
    expect(readSort(p('sort=password'), allowed, 'name')).toEqual({ sort: 'name', ascending: true })
    expect(readSort(p(''), allowed, 'created_at', false)).toEqual({
      sort: 'created_at',
      ascending: false,
    })
  })
})

describe('patchParams', () => {
  it('sets, removes and resets the page', () => {
    expect(patchParams(p('q=a&page=4'), { status: 'active' }).toString()).toBe('q=a&status=active')
    expect(patchParams(p('q=a&status=active'), { status: '' }).toString()).toBe('q=a')
    expect(patchParams(p('q=a&page=4'), { page: 5 }).toString()).toBe('q=a&page=5')
    expect(patchParams(p('q=a&page=4'), { page: 1 }).toString()).toBe('q=a')
  })
  it('does not mutate its input', () => {
    const original = p('q=a')
    patchParams(original, { q: 'b' })
    expect(original.toString()).toBe('q=a')
  })
})

describe('nextSort', () => {
  it('toggles direction on the active column and starts ascending on a new one', () => {
    expect(nextSort({ sort: 'name', ascending: true }, 'name')).toEqual({
      sort: 'name',
      dir: 'desc',
    })
    expect(nextSort({ sort: 'name', ascending: false }, 'name')).toEqual({
      sort: 'name',
      dir: 'asc',
    })
    expect(nextSort({ sort: 'name', ascending: false }, 'status')).toEqual({
      sort: 'status',
      dir: 'asc',
    })
  })
})

describe('pageCount', () => {
  it('rounds up and is never zero', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
    expect(pageCount(475, 25)).toBe(19)
  })
})
