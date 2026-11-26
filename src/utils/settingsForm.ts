import type { BusinessProfile } from '@/types/settings'

export type BusinessErrors = Partial<Record<keyof BusinessProfile, string>>

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** The same rules the database applies, so problems show beside the field before saving. */
export function validateBusiness(p: BusinessProfile): BusinessErrors {
  const e: BusinessErrors = {}
  const name = p.name.trim()
  if (!name) e.name = 'Enter the business name.'
  else if (name.length > 120) e.name = 'Use 120 characters or fewer.'
  if (p.email?.trim() && !EMAIL.test(p.email.trim())) e.email = 'Enter a valid email address.'
  if (p.website?.trim() && !/^https?:\/\/\S+$/.test(p.website.trim())) {
    e.website = 'Start the website with https:// or http://'
  }
  if (p.postalCode?.trim() && !/^\d{4}$/.test(p.postalCode.trim())) {
    e.postalCode = 'A postal code has four digits.'
  }
  if ((p.description ?? '').trim().length > 500) e.description = 'Use 500 characters or fewer.'
  if ((p.address ?? '').trim().length > 300) e.address = 'Use 300 characters or fewer.'
  return e
}

export type PasswordErrors = Partial<Record<'current' | 'next' | 'confirm', string>>

/** At least 12 characters with upper and lower case letters and a number. */
export function validateNewPassword(
  current: string,
  next: string,
  confirm: string,
): PasswordErrors {
  const e: PasswordErrors = {}
  if (!current) e.current = 'Enter your current password.'
  if (next.length < 12) e.next = 'Use at least 12 characters.'
  else if (!/[a-z]/.test(next) || !/[A-Z]/.test(next) || !/\d/.test(next)) {
    e.next = 'Mix upper and lower case letters and at least one number.'
  } else if (next === current) e.next = 'Choose a password different from your current one.'
  if (!e.next && confirm !== next) e.confirm = 'The two new passwords do not match.'
  return e
}
