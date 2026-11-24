import type { AppError, ErrorCode, Result } from '@/types/api'

const CODES: ErrorCode[] = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'network',
  'unknown',
]

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })

export const err = (error: AppError): Result<never> => ({ ok: false, error })

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data
  throw new Error(result.error.message)
}

export function toAppError(e: unknown): AppError {
  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: unknown; message: unknown }
    if (CODES.includes(code as ErrorCode) && typeof message === 'string') {
      return { code: code as ErrorCode, message }
    }
  }
  if (e instanceof Error) return { code: 'unknown', message: e.message }
  return { code: 'unknown', message: 'An unexpected error occurred' }
}
