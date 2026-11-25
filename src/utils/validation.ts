export const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())

export interface PasswordChecks {
  length: boolean
  uppercase: boolean
  number: boolean
  special: boolean
}

/** Rules shown on the Stitch reset-password screen. */
export const passwordChecks = (value: string): PasswordChecks => ({
  length: value.length >= 8,
  uppercase: /[A-Z]/.test(value),
  number: /\d/.test(value),
  special: /[^A-Za-z0-9]/.test(value),
})

export const passwordIsValid = (value: string): boolean =>
  Object.values(passwordChecks(value)).every(Boolean)
