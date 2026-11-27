import type { FetchLike, SendResult } from './types.js'

/** Reads a JSON body, or an empty object when there is none or it is not JSON. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const text = await res.text()
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** A short, safe description of a provider's answer: status and error codes, never message content. */
export function trimmed(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * A request to a provider. Network failures come back as { network: true } instead of throwing,
 * so callers can decide whether a retry is safe.
 */
export async function call(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<
  | { network: false; res: Response; body: Record<string, unknown> }
  | { network: true; error: string }
> {
  try {
    const res = await fetchImpl(url, init)
    return { network: false, res, body: await readJson(res) }
  } catch (e) {
    return { network: true, error: (e as Error).message }
  }
}

/**
 * How a failed send is handled. A rate limit (429) means the provider did nothing, so it is always
 * retried. For other temporary failures (network, 5xx) the message may already have gone: retried
 * only for providers that refuse duplicates; otherwise it waits for a person.
 */
export function failure(
  provider: string,
  outcome: { network: true; error: string } | { status: number; code?: string; message: string },
  idempotent: boolean,
): Extract<SendResult, { ok: false }> {
  if ('network' in outcome) {
    return {
      ok: false,
      retryable: idempotent,
      error: idempotent
        ? trimmed(`${provider}: network error: ${outcome.error}`)
        : trimmed(
            `${provider}: no answer (${outcome.error}). It may have been sent; check before trying again.`,
          ),
    }
  }
  const { status, code, message } = outcome
  const temporary = status >= 500
  return {
    ok: false,
    retryable: status === 429 || (temporary && idempotent),
    error: trimmed(
      `${provider} ${status}${code ? ` ${code}` : ''}: ${message}${
        temporary && !idempotent ? ' It may have been sent; check before trying again.' : ''
      }`,
    ),
    response: { status, ...(code ? { code } : {}) },
  }
}

export const form = (data: Record<string, string>) => new URLSearchParams(data).toString()
