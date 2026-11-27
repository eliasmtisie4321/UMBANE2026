import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as searchService from '@/services/search'
import type { UserRole } from '@/types/auth'
import { err, ok } from '@/utils/result'
import { TopBar } from './TopBar'

vi.mock('@/services/search', async (real) => ({
  ...(await real<typeof import('@/services/search')>()),
  searchEverything: vi.fn(),
}))
const search = vi.mocked(searchService.searchEverything)

const onNavigate = vi.fn()
const open = (role: UserRole = 'manager') =>
  render(
    <TopBar
      onOpenMenu={vi.fn()}
      onNavigate={onNavigate}
      role={role}
      userName="Mia Manager"
      roleLabel="Manager"
    />,
  )

beforeEach(() => {
  vi.clearAllMocks()
  search.mockResolvedValue(
    ok([
      {
        kind: 'customer',
        id: 'c2',
        title: 'Thabo Mokoena',
        subtitle: 'thabo@example.co.za',
        link: '/customers/c2',
      },
      {
        kind: 'invoice',
        id: 'i3',
        title: 'INV-2026-00003',
        subtitle: 'Thabo Mokoena',
        link: '/invoices/i3',
      },
      { kind: 'person', id: 'p1', title: 'Thabo Staff', subtitle: null, link: '/team/p1' },
    ]),
  )
})

describe('the clock', () => {
  afterEach(() => vi.useRealTimers())

  it('shows South African time and moves on each minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T12:05:30Z'))
    open()
    const clock = screen.getByTitle('South African time')
    expect(clock).toHaveTextContent('14:05')
    expect(clock).toHaveTextContent(/Fri,? 27 Nov/)
    act(() => vi.advanceTimersByTime(31_000))
    expect(clock).toHaveTextContent('14:06')
  })
})

describe('Quick Add', () => {
  it('offers what the role may create, and opens it', async () => {
    open('manager')
    await userEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    const menu = screen.getByRole('menu', { name: 'Create new' })
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    expect(items).toEqual(
      expect.arrayContaining(['Customer', 'Invoice', 'Support ticket', 'Task', 'Calendar event']),
    )
    expect(items).not.toContain('Employee')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Invoice' }))
    expect(onNavigate).toHaveBeenCalledWith('/invoices/new')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('lets administrators add employees', async () => {
    open('administrator')
    await userEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    expect(screen.getByRole('menuitem', { name: 'Employee' })).toBeInTheDocument()
  })

  it('works from the keyboard', async () => {
    open('manager')
    screen.getByRole('button', { name: 'Quick add' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(items[items.length - 1]).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Quick add' })).toHaveFocus()
  })

  it('gives a client one button: reporting a problem', async () => {
    open('client')
    await userEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(onNavigate).toHaveBeenCalledWith('/support-tickets/new')
  })
})

describe('search', () => {
  const box = () => screen.getAllByRole('combobox', { name: 'Search' })[0]

  it('finds records across modules, grouped, and opens the chosen one', async () => {
    open('manager')
    await userEvent.type(box(), 'thab')
    const list = await screen.findByRole('listbox', { name: 'Search results' })
    expect(await within(list).findByRole('option', { name: /^Thabo Mokoena/ })).toBeInTheDocument()
    expect(within(list).getByRole('group', { name: 'Customers' })).toBeInTheDocument()
    expect(within(list).getByRole('group', { name: 'Invoices' })).toBeInTheDocument()
    expect(search).toHaveBeenLastCalledWith('thab')
    await userEvent.click(within(list).getByRole('option', { name: /^INV-2026-00003/ }))
    expect(onNavigate).toHaveBeenCalledWith('/invoices/i3')
  })

  it('only offers pages the role can open', async () => {
    open('staff')
    await userEvent.type(box(), 'thab')
    expect(await screen.findByRole('option', { name: /^Thabo Mokoena/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Thabo Staff/ })).toBeNull()
  })

  it('moves with the arrow keys and opens with Enter', async () => {
    open('manager')
    await userEvent.type(box(), 'thab')
    await screen.findByRole('option', { name: /^Thabo Mokoena/ })
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(box()).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /^INV-2026-00003/ }).id,
    )
    await userEvent.keyboard('{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('/invoices/i3')
  })

  it('says when nothing matches, or search is not available', async () => {
    search.mockResolvedValueOnce(ok([]))
    open('manager')
    await userEvent.type(box(), 'zzz')
    expect(await screen.findByText('Nothing matches “zzz”.')).toBeInTheDocument()
    search.mockResolvedValueOnce(err({ code: 'network', message: 'offline' }))
    await userEvent.type(box(), 'q')
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is not available right now')
  })

  it('does not search for one letter', async () => {
    open('manager')
    await userEvent.type(box(), 't')
    await new Promise((r) => setTimeout(r, 400))
    expect(search).not.toHaveBeenCalled()
  })

  it('jumps to search with "/" from anywhere on the page', async () => {
    open('manager')
    await userEvent.keyboard('/')
    expect(box()).toHaveFocus()
  })

  it('opens from a button on phones', async () => {
    open('manager')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    const dialog = screen.getByRole('dialog', { name: 'Search' })
    expect(within(dialog).getByRole('combobox', { name: 'Search' })).toHaveFocus()
  })
})
