export type ErrorCode =
  'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'network' | 'unknown'

export interface AppError {
  code: ErrorCode
  message: string
}

/** Every service function returns a Result instead of throwing. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
