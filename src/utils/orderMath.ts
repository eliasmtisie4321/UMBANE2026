/**
 * Preview of the order totals calculated by the database trigger `check_order` (migration 0007).
 * Works in whole cents with BigInt, so there is no floating-point drift. The database's figures are
 * the ones that count; keep the two in step. See docs/SALES.md.
 */

/** "1 234.5" becomes 123450 cents; null if it is not an amount. Commas are refused, not guessed. */
export function parseCents(input: string): bigint | null {
  const s = input.replace(/\s/g, '')
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(s)
  return m ? BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')) : null
}

export const centsToRand = (cents: bigint): number => Number(cents) / 100

/** A percentage with up to two decimals, as hundredths of a percent; null if outside 0 to 100. */
export function parsePercent(input: string): bigint | null {
  const hundredths = parseCents(input)
  return hundredths === null || hundredths > 10_000n ? null : hundredths
}

/** Positive whole number up to 100,000; null otherwise. */
export function parseQuantity(input: string): number | null {
  const s = input.trim()
  return /^[1-9]\d{0,5}$/.test(s) && Number(s) <= 100_000 ? Number(s) : null
}

/** cents x (hundredths of a percent), rounded half up to a whole cent. */
const percentOf = (cents: bigint, hundredths: bigint) => (cents * hundredths + 5_000n) / 10_000n

export interface OrderTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
}

export function orderTotals(
  lines: Array<{ quantity: number; unitCents: bigint }>,
  discountHundredths: bigint,
  vatRate: number,
): OrderTotals {
  const subtotal = lines.reduce((sum, l) => sum + BigInt(l.quantity) * l.unitCents, 0n)
  const discount = percentOf(subtotal, discountHundredths)
  const tax = percentOf(subtotal - discount, BigInt(Math.round(vatRate * 100)))
  return {
    subtotal: centsToRand(subtotal),
    discount: centsToRand(discount),
    tax: centsToRand(tax),
    total: centsToRand(subtotal - discount + tax),
  }
}
