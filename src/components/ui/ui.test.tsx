import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, Input, Modal } from '.'

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>)
    const btn = screen.getByRole('button', { name: /save/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Input', () => {
  it('associates its label and exposes the error', () => {
    render(<Input id="email" label="Email" error="Required" />)
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Required')
  })
})

describe('Modal', () => {
  it('renders a labelled dialog and closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="Confirm" onClose={onClose}>
        body
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} title="Hidden" onClose={() => {}}>
        x
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
