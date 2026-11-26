import type { CustomerPreferences, Purpose } from '@/types/messages'

/** Placeholders the app fills in, and what each means. */
export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'customer_name', label: 'Customer name' },
  { key: 'business_name', label: 'Your business name' },
  { key: 'sender_name', label: 'Your name' },
  { key: 'message', label: 'The message you type' },
  { key: 'invoice_number', label: 'Invoice number' },
  { key: 'invoice_total', label: 'Invoice total' },
  { key: 'balance_due', label: 'Balance due' },
  { key: 'due_date', label: 'Invoice due date' },
  { key: 'ticket_reference', label: 'Ticket reference' },
  { key: 'ticket_subject', label: 'Ticket title' },
]

const PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g

export interface Rendered {
  text: string
  /** Placeholders with no value, left as written so the person can see and fix them. */
  missing: string[]
}

export function renderTemplate(
  text: string,
  values: Record<string, string | null | undefined>,
): Rendered {
  const missing = new Set<string>()
  const out = text.replace(PATTERN, (whole, key: string) => {
    const v = values[key]
    if (v === null || v === undefined || v === '') {
      missing.add(key)
      return whole
    }
    return v
  })
  return { text: out, missing: [...missing] }
}

export const placeholdersIn = (text: string) => [
  ...new Set([...text.matchAll(PATTERN)].map((m) => m[1])),
]

/** Placeholders a template uses that the app does not know. */
export const unknownPlaceholders = (text: string) =>
  placeholdersIn(text).filter((k) => !PLACEHOLDERS.some((p) => p.key === k))

export const SUBJECT_MAX = 200
export const BODY_MAX = 10000

export interface TemplateFormValues {
  key: string
  name: string
  purpose: Purpose
  subject: string
  body: string
  isActive: boolean
}

export type TemplateFormErrors = Partial<Record<keyof TemplateFormValues, string>>

export function validateTemplate(v: TemplateFormValues, isNew: boolean): TemplateFormErrors {
  const e: TemplateFormErrors = {}
  if (isNew && !/^[a-z][a-z0-9_]{1,39}$/.test(v.key))
    e.key = 'Use 2 to 40 lower-case letters, numbers or underscores, starting with a letter.'
  if (v.name.trim().length < 2) e.name = 'Give the template a name.'
  if (!v.subject.trim()) e.subject = 'Write a subject line.'
  else if (v.subject.trim().length > SUBJECT_MAX)
    e.subject = `Keep the subject to ${SUBJECT_MAX} characters.`
  else if (unknownPlaceholders(v.subject).length)
    e.subject = `Unknown placeholder: {{${unknownPlaceholders(v.subject)[0]}}}.`
  if (!v.body.trim()) e.body = 'Write the message.'
  else if (v.body.trim().length > BODY_MAX) e.body = `Keep the message to ${BODY_MAX} characters.`
  else if (unknownPlaceholders(v.body).length)
    e.body = `Unknown placeholder: {{${unknownPlaceholders(v.body)[0]}}}.`
  return e
}

export interface EmailFormErrors {
  subject?: string
  body?: string
}

export function validateEmail(subject: string, body: string): EmailFormErrors {
  const e: EmailFormErrors = {}
  const left = [...placeholdersIn(subject), ...placeholdersIn(body)]
  if (!subject.trim()) e.subject = 'Write a subject line.'
  else if (subject.trim().length > SUBJECT_MAX)
    e.subject = `Keep the subject to ${SUBJECT_MAX} characters.`
  if (!body.trim()) e.body = 'Write the message.'
  else if (body.trim().length > BODY_MAX) e.body = `Keep the message to ${BODY_MAX} characters.`
  if (left.length && !e.body) e.body = `Fill in or remove {{${left[0]}}} before sending.`
  return e
}

/** Why this customer cannot be emailed for this purpose, in words; null when they can. */
export function whyNotEmail(p: CustomerPreferences, purpose: Purpose): string | null {
  if (!p.email) return 'This customer has no email address. Add one to their profile first.'
  if (p.suppressedAt)
    return p.suppressedReason === 'complained'
      ? 'This customer marked an earlier email as spam, so email to them is stopped.'
      : 'Email to this address bounced, so it is stopped. Update their email address to try again.'
  if (p.emailOptOut) return 'This customer has asked not to receive email.'
  if (purpose === 'marketing' && !p.marketingConsent)
    return 'Marketing email needs the customer’s recorded consent.'
  return null
}
