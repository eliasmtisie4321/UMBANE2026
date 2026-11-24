import { describe, expect, it } from 'vitest'
import { err, ok, toAppError, unwrap } from './result'

describe('result helpers', () => {
  it('wraps success and failure', () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 })
    expect(err({ code: 'not_found', message: 'x' })).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'x' },
    })
  })

  it('unwrap returns data or throws the error message', () => {
    expect(unwrap(ok('a'))).toBe('a')
    expect(() => unwrap(err({ code: 'forbidden', message: 'nope' }))).toThrow('nope')
  })

  it('toAppError normalises unknown errors', () => {
    expect(toAppError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' })
    expect(toAppError('weird')).toEqual({
      code: 'unknown',
      message: 'An unexpected error occurred',
    })
    expect(toAppError({ code: 'forbidden', message: 'no' })).toEqual({
      code: 'forbidden',
      message: 'no',
    })
  })
})
