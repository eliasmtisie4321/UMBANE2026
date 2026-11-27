import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { canAccess } from '@/auth/permissions'
import {
  SEARCH_KINDS,
  SEARCH_KIND_LABEL,
  searchEverything,
  type SearchResult,
} from '@/services/search'
import type { UserRole } from '@/types/auth'

interface GlobalSearchProps {
  role: UserRole
  onNavigate: (to: string) => void
  /** Focus the box as soon as it appears (the phone search dialog). */
  autoFocus?: boolean
  /** Listen for "/" and Ctrl+K anywhere on the page (the top bar's box only). */
  shortcut?: boolean
  /** Called after a result is opened. */
  onDone?: () => void
}

const DEBOUNCE_MS = 250

/**
 * Search across every module from the top bar. Results come from the database as the signed-in
 * person (row security decides what can be found), grouped by kind, and only pages the person's
 * role can open are offered. Keyboard: arrows move, Enter opens, Escape closes; "/" or Ctrl+K
 * jumps here from anywhere.
 */
export function GlobalSearch({ role, onNavigate, autoFocus, shortcut, onDone }: GlobalSearchProps) {
  const [text, setText] = useState('')
  // The last answer, with the text it answers: an answer for older text is never shown.
  const [answer, setAnswer] = useState<{
    query: string
    results: SearchResult[]
    failed: boolean
  } | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const query = text.trim()

  useEffect(() => {
    if (query.length < 2) return
    let stale = false
    const timer = window.setTimeout(async () => {
      const r = await searchEverything(query)
      if (stale) return
      const allowed = r.ok ? r.data.filter((x) => canAccess(role, x.link)) : []
      // In the order they are shown, so arrow keys follow the screen.
      setAnswer({
        query,
        results: SEARCH_KINDS.flatMap((k) => allowed.filter((x) => x.kind === k)),
        failed: !r.ok,
      })
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [query, role])

  const current = query.length >= 2 && answer?.query === query ? answer : null
  const results = current?.results ?? []
  const status: 'idle' | 'loading' | 'done' | 'error' =
    query.length < 2 ? 'idle' : !current ? 'loading' : current.failed ? 'error' : 'done'

  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        input.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shortcut])

  function go(r: SearchResult) {
    setOpen(false)
    setText('')
    onNavigate(r.link)
    onDone?.()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const chosen = results[active] ?? results[0]
      if (chosen) {
        e.preventDefault()
        go(chosen)
      }
    } else if (e.key === 'Escape') {
      if (open && query) setOpen(false)
      else setText('')
    }
  }

  const showList = open && query.length >= 2
  const optionId = (i: number) => `${listId}-option-${i}`

  return (
    <div
      className="relative w-full"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
        aria-hidden="true"
      />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search customers, meters, invoices…"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setActive(-1)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-outline-variant bg-surface-container-low py-2 pl-9 pr-3 text-body-md placeholder:text-outline focus:border-primary focus:bg-surface"
      />
      <div
        className={`absolute left-0 right-0 z-30 mt-1 max-h-[70vh] overflow-auto rounded-md border border-outline-variant bg-surface p-1 shadow-card ${showList ? '' : 'hidden'}`}
      >
        {status === 'loading' && results.length === 0 && (
          <p role="status" className="px-3 py-2 text-body-md text-on-surface-variant">
            Searching…
          </p>
        )}
        {status === 'error' && (
          <p role="alert" className="px-3 py-2 text-body-md text-error">
            Search is not available right now. Please try again.
          </p>
        )}
        {status === 'done' && results.length === 0 && (
          <p role="status" className="px-3 py-2 text-body-md text-on-surface-variant">
            Nothing matches “{query}”.
          </p>
        )}
        <ul id={listId} role="listbox" aria-label="Search results">
          {SEARCH_KINDS.filter((k) => results.some((r) => r.kind === k)).map((kind) => (
            <li key={kind} role="presentation">
              <p
                id={`${listId}-${kind}`}
                className="px-3 pb-1 pt-2 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant"
              >
                {SEARCH_KIND_LABEL[kind]}
              </p>
              <ul role="group" aria-labelledby={`${listId}-${kind}`}>
                {results.map((r, i) =>
                  r.kind !== kind ? null : (
                    <li
                      key={`${r.kind}-${r.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      // Keep focus in the box while choosing, so the list does not close first.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={`cursor-pointer rounded-md px-3 py-2 ${i === active ? 'bg-primary-container' : 'hover:bg-surface-container'}`}
                    >
                      <span className="block truncate text-body-md font-medium text-on-surface">
                        {r.title}
                      </span>
                      {r.subtitle && (
                        <span className="block truncate text-label-sm text-on-surface-variant">
                          {r.subtitle}
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
