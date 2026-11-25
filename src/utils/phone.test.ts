import { describe, expect, it } from 'vitest'
import { formatPhone, normalizePhone } from './phone'

describe('normalizePhone', () => {
  it('accepts every common South African format', () => {
    for (const input of [
      '082 441 9082',
      '0824419082',
      '+27 82 441 9082',
      '+27824419082',
      '27824419082',
      '0027 82 441 9082',
    ]) {
      expect(normalizePhone(input)).toBe('+27824419082')
    }
    expect(normalizePhone('+27 (11) 482-1900')).toBe('+27114821900')
  })
  it('accepts other international numbers', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
  })
  it('rejects things that are not phone numbers', () => {
    for (const bad of [
      '',
      '   ',
      '12345',
      'abc',
      '082 441 908',
      '082 441 90822',
      '+27 82 441 908',
      '+1',
    ]) {
      expect(normalizePhone(bad)).toBeNull()
    }
  })
})

describe('formatPhone', () => {
  it('groups South African numbers and leaves others alone', () => {
    expect(formatPhone('+27824419082')).toBe('+27 82 441 9082')
    expect(formatPhone('+442079460958')).toBe('+442079460958')
    expect(formatPhone(null)).toBe('-')
  })
})
