export type ErrorCode =
  'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'network' | 'unknown'

export interface AppError {
  code: ErrorCode
  message: string
  /** Form field the message belongs to (e.g. a duplicate email), so a form can show it in place. */
  field?: string
}

/** Every service function returns a Result instead of throwing. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
