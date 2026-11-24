import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface DropdownProps {
  label: string
  trigger: ReactNode
  children: ReactNode
}

/** Simple disclosure menu. Closes on Escape and outside click. */
export function Dropdown({ label, trigger, children }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center rounded-md p-2 text-on-surface-variant hover:bg-surface-container"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 z-20 mt-2 min-w-48 rounded-md border border-outline-variant bg-surface p-1 shadow-card"
        >
          {children}
        </div>
      )}
    </div>
  )
}
