import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppError, Result } from '@/types/api'

export type Resource<T> =
  /** First load: nothing to show yet. */
  | { status: 'loading'; data: null }
  /** Reloading: the previous data stays on screen, dimmed, so the layout never jumps. */
  | { status: 'refreshing'; data: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T | null; error: AppError }

/**
 * Runs `load` whenever `key` changes (and on reload()). Loading state is derived from the key, not
 * set inside the effect, so a stale response for an old key can never overwrite a newer one.
 */
export function useResource<T>(
  load: () => Promise<Result<T>>,
  key: string,
): Resource<T> & { reload: () => void } {
  const [nonce, setNonce] = useState(0)
  const fullKey = `${key}#${nonce}`
  const [settled, setSettled] = useState<{ key: string; result: Result<T> } | null>(null)
  const [lastData, setLastData] = useState<T | null>(null)

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let active = true
    void loadRef.current().then((result) => {
      if (!active) return
      setSettled({ key: fullKey, result })
      if (result.ok) setLastData(result.data)
    })
    return () => {
      active = false
    }
  }, [fullKey])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const current = settled?.key === fullKey ? settled.result : null

  if (current === null) {
    return lastData === null
      ? { status: 'loading', data: null, reload }
      : { status: 'refreshing', data: lastData, reload }
  }
  if (current.ok) return { status: 'ready', data: current.data, reload }
  return { status: 'error', data: lastData, error: current.error, reload }
}
