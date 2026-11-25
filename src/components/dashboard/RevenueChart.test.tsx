import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RevenueChart } from './RevenueChart'

const points = [
  { month: '2026-09-01', total: 300 },
  { month: '2026-10-01', total: 0 },
  { month: '2026-11-01', total: 1200 },
]

describe('RevenueChart', () => {
  it('describes the whole series to screen readers', () => {
    render(<RevenueChart points={points} />)
    expect(
      screen.getByRole('img', { name: 'Revenue by month: Sep R 300, Oct R 0, Nov R 1,200' }),
    ).toBeInTheDocument()
  })

  it('labels only the end point and the axis, not every value', () => {
    const { container } = render(<RevenueChart points={points} />)
    const labels = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)
    // Axis for a 1,200 maximum: 0 to 2,000 in steps of 500. The only other label is the end point.
    expect(labels).toEqual(expect.arrayContaining(['R0', 'R500', 'R1K', 'R1.5K', 'R2K']))
    expect(labels.filter((l) => l === 'R1.2K')).toHaveLength(1)
    // Earlier points are not labelled directly (they live in the tooltip and the table view).
    expect(labels).not.toContain('R300')
  })

  it('moves a tooltip with the arrow keys and clears it on Escape', async () => {
    render(<RevenueChart points={points} />)
    await userEvent.tab()
    expect(screen.getByRole('group')).toHaveFocus()
    expect(screen.queryByRole('status')).toBeNull()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent('R 300')
    expect(screen.getByRole('status')).toHaveTextContent('September 2026')

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('status')).toHaveTextContent('R 1,200')

    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('status')).toHaveTextContent('R 0')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not run past either end', async () => {
    render(<RevenueChart points={points} />)
    await userEvent.tab()
    await userEvent.keyboard('{Home}{ArrowLeft}')
    expect(screen.getByRole('status')).toHaveTextContent('September 2026')
    await userEvent.keyboard('{End}{ArrowRight}')
    expect(screen.getByRole('status')).toHaveTextContent('November 2026')
  })

  it('offers every value as a table', () => {
    render(<RevenueChart points={points} asTable />)
    expect(screen.getByRole('table', { name: 'Revenue received per month' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'October 2026' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'R 1,200' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('copes with a single month', () => {
    render(<RevenueChart points={[{ month: '2026-11-01', total: 50 }]} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
