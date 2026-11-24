import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppLayout } from './AppLayout'
import { NAV_ITEMS } from './navItems'

describe('AppLayout', () => {
  it('renders all navigation links and marks the current page', () => {
    render(<AppLayout currentPath="/customers">content</AppLayout>)
    const nav = screen.getByRole('navigation')
    expect(nav.querySelectorAll('a')).toHaveLength(NAV_ITEMS.length)
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('opens and closes the mobile menu', async () => {
    render(<AppLayout>x</AppLayout>)
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('sidebar-backdrop'))
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull()
  })
})
