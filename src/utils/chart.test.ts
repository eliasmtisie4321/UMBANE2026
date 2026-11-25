import { describe, expect, it } from 'vitest'
import { niceMax } from './chart'

describe('niceMax', () => {
  it('rounds up to a tidy axis maximum divisible into four ticks', () => {
    expect(niceMax(437)).toBe(800) // ticks of 200
    expect(niceMax(300)).toBe(400) // ticks of 100
    expect(niceMax(900)).toBe(1000)
    expect(niceMax(1_482_950)).toBe(2_000_000)
    expect(niceMax(4)).toBe(4)
  })
  it('never returns less than the data', () => {
    for (const v of [1, 7, 99, 100, 101, 12_345, 999_999])
      expect(niceMax(v)).toBeGreaterThanOrEqual(v)
  })
  it('has a safe fallback for empty data', () => {
    expect(niceMax(0)).toBe(1)
  })
})
