import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Table, Td, Th } from './Table'

describe('Table', () => {
  it('scrolls sideways inside its own positioned wrapper', () => {
    render(
      <Table>
        <caption className="sr-only">Things</caption>
        <thead>
          <tr>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>x</Td>
          </tr>
        </tbody>
      </Table>,
    )
    const wrapper = screen.getByRole('table').parentElement!
    expect(wrapper).toHaveClass('overflow-x-auto')
    // Without `relative`, screen-reader-only text (position: absolute) escapes the scroller and
    // widens the page on small screens.
    expect(wrapper).toHaveClass('relative')
  })
})
