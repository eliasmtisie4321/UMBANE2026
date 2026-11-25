/**
 * Normalises a phone number to international form (+27824419082), or returns null if it is not a
 * plausible number. South African numbers must have exactly nine digits after +27.
 */
export function normalizePhone(input: string): string | null {
  let n = input.trim().replace(/[\s\-().]/g, '')
  if (!n) return null
  if (n.startsWith('00')) n = `+${n.slice(2)}`
  else if (n.startsWith('0')) n = `+27${n.slice(1)}`
  else if (/^27\d{9}$/.test(n)) n = `+${n}`
  if (!/^\+\d{8,15}$/.test(n)) return null
  if (n.startsWith('+27') && !/^\+27\d{9}$/.test(n)) return null
  return n
}

/** +27824419082 becomes "+27 82 441 9082". Other numbers are shown as stored. */
export function formatPhone(phone: string | null): string {
  if (!phone) return '-'
  if (/^\+27\d{9}$/.test(phone))
    return `+27 ${phone.slice(3, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`
  return phone
}
