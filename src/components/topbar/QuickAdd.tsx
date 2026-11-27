import { Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { UserRole } from '@/types/auth'
import { quickAddFor } from '@/utils/quickAdd'

/**
 * The top bar's Quick Add: a menu of the create pages the person's role can open. A client has
 * only one (reporting a problem), so they get that button directly.
 */
export function QuickAdd({
  role,
  onNavigate,
}: {
  role: UserRole
  onNavigate: (to: string) => void
}) {
  const actions = quickAddFor(role)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    items.current[0]?.focus()
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (actions.length === 0) return null
  const buttonClass =
    'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-label-md font-semibold text-on-primary transition-colors duration-[120ms] hover:bg-primary-hover sm:px-4'

  if (actions.length === 1) {
    const only = actions[0]
    return (
      <button
        type="button"
        onClick={() => onNavigate(only.to)}
        className={buttonClass}
        aria-label="Report a problem"
      >
        <Plus size={16} aria-hidden="true" />
        <span className="hidden sm:inline">Report a Problem</span>
      </button>
    )
  }

  function choose(to: string) {
    setOpen(false)
    onNavigate(to)
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = items.current.filter(Boolean) as HTMLButtonElement[]
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const move = (i: number) => list[(i + list.length) % list.length]?.focus()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(at + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(at - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(list.length - 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Quick add"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={buttonClass}
      >
        <Plus size={16} aria-hidden="true" />
        <span className="hidden sm:inline">Quick Add</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Create new"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-2 max-h-[75vh] w-56 overflow-auto rounded-md border border-outline-variant bg-surface p-1 shadow-card"
        >
          {actions.map((a, i) => (
            <button
              key={a.to}
              ref={(el) => {
                items.current[i] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(a.to)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-label-md text-on-surface hover:bg-surface-container focus:bg-surface-container"
            >
              <a.icon size={16} aria-hidden="true" className="text-on-surface-variant" />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
