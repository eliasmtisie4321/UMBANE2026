const luhnValid = (digits: string): boolean => {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A South African ID: 13 digits, a real YYMMDD birth date, and a correct Luhn check digit. */
export function isValidSaId(id: string, now: Date = new Date()): boolean {
  if (!/^\d{13}$/.test(id)) return false
  const yy = Number(id.slice(0, 2))
  const month = Number(id.slice(2, 4))
  const day = Number(id.slice(4, 6))
  const year = yy <= now.getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return false
  return luhnValid(id)
}

/** Shows only the birth date prefix and last two digits: 880514•••••84. */
export function maskSaId(id: string | null): string {
  if (!id) return '-'
  return id.length === 13 ? `${id.slice(0, 6)}•••••${id.slice(-2)}` : '•'.repeat(id.length)
}
