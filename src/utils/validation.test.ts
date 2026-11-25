import { describe, expect, it } from 'vitest'
import { isValidEmail, passwordChecks, passwordIsValid } from './validation'

describe('isValidEmail', () => {
  it('accepts normal addresses and trims whitespace', () => {
    expect(isValidEmail('name@umbane.co.za')).toBe(true)
    expect(isValidEmail('  a.b+c@example.com ')).toBe(true)
  })
  it('rejects malformed addresses', () => {
    for (const bad of ['', 'plain', 'a@b', '@x.com', 'a b@x.com', 'a@@x.com']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })
})

describe('passwordChecks', () => {
  it('reports each rule separately', () => {
    expect(passwordChecks('abc')).toEqual({
      length: false,
      uppercase: false,
      number: false,
      special: false,
    })
    expect(passwordChecks('Abcdefg1!')).toEqual({
      length: true,
      uppercase: true,
      number: true,
      special: true,
    })
  })
  it('requires all four rules', () => {
    expect(passwordIsValid('Abcdefg1!')).toBe(true)
    expect(passwordIsValid('abcdefg1!')).toBe(false)
    expect(passwordIsValid('Abcdefgh!')).toBe(false)
    expect(passwordIsValid('Abcdefg12')).toBe(false)
    expect(passwordIsValid('Ab1!')).toBe(false)
  })
})
