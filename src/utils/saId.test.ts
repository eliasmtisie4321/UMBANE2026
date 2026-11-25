import { describe, expect, it } from 'vitest'
import { isValidSaId, maskSaId } from './saId'

const NOW = new Date('2026-11-25T00:00:00Z')

describe('isValidSaId', () => {
  it('accepts real-format IDs with a correct check digit', () => {
    expect(isValidSaId('8001015009087', NOW)).toBe(true)
    expect(isValidSaId('8805145028084', NOW)).toBe(true)
    expect(isValidSaId('9001015800088', NOW)).toBe(true)
  })
  it('rejects a wrong check digit', () => {
    expect(isValidSaId('8001015009088', NOW)).toBe(false)
  })
  it('rejects wrong length and non-digits', () => {
    for (const bad of ['', '800101500908', '80010150090871', '80010150090ab', '8001 015009087']) {
      expect(isValidSaId(bad, NOW)).toBe(false)
    }
  })
  it('rejects impossible birth dates even with a matching check digit', () => {
    // 13th month and 31 February, each given a valid Luhn digit so only the date check can fail.
    const withCheckDigit = (prefix: string) =>
      Array.from({ length: 10 }, (_, c) => prefix + c).find((id) => {
        let sum = 0
        for (let i = 0; i < id.length; i++) {
          let d = Number(id[id.length - 1 - i])
          if (i % 2 === 1) {
            d *= 2
            if (d > 9) d -= 9
          }
          sum += d
        }
        return sum % 10 === 0
      })!
    expect(isValidSaId(withCheckDigit('800001500908'), NOW)).toBe(false) // month 00
    expect(isValidSaId(withCheckDigit('801301500908'), NOW)).toBe(false) // month 13
    expect(isValidSaId(withCheckDigit('800231500908'), NOW)).toBe(false) // 31 February
    expect(isValidSaId(withCheckDigit('800101500908'), NOW)).toBe(true)
  })
  it('respects leap years when reading the century', () => {
    const luhn = (prefix: string) =>
      Array.from({ length: 10 }, (_, c) => prefix + c).find((id) => {
        let sum = 0
        for (let i = 0; i < id.length; i++) {
          let d = Number(id[id.length - 1 - i])
          if (i % 2 === 1) {
            d *= 2
            if (d > 9) d -= 9
          }
          sum += d
        }
        return sum % 10 === 0
      })!
    expect(isValidSaId(luhn('960229500908'), NOW)).toBe(true) // 1996 was a leap year
    expect(isValidSaId(luhn('970229500908'), NOW)).toBe(false) // 1997 was not
  })
})

describe('maskSaId', () => {
  it('hides the middle of the number', () => {
    expect(maskSaId('8805145028084')).toBe('880514•••••84')
    expect(maskSaId(null)).toBe('-')
  })
})
