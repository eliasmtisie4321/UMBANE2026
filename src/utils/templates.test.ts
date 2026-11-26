import { describe, expect, it } from 'vitest'
import {
  placeholdersIn,
  renderTemplate,
  unknownPlaceholders,
  validateEmail,
  validateTemplate,
  whyNotEmail,
} from './templates'

const prefs = {
  email: 'cleo@example.co.za',
  emailOptOut: false,
  marketingConsent: false,
  consentUpdatedAt: null,
  suppressedAt: null,
  suppressedReason: null,
}

describe('templates', () => {
  it('fills placeholders and reports the ones without a value', () => {
    const r = renderTemplate(
      'Hi {{customer_name}}, invoice {{ invoice_number }} due {{due_date}}',
      {
        customer_name: 'Cleo',
        invoice_number: 'INV-1',
        due_date: '',
      },
    )
    expect(r.text).toBe('Hi Cleo, invoice INV-1 due {{due_date}}')
    expect(r.missing).toEqual(['due_date'])
  })

  it('does not treat filled-in text as more placeholders', () => {
    expect(renderTemplate('{{message}}', { message: 'Use {{this}} literally' }).text).toBe(
      'Use {{this}} literally',
    )
  })

  it('finds placeholders and the ones the app does not know', () => {
    expect(placeholdersIn('{{a_b}} {{a_b}} {{c}}')).toEqual(['a_b', 'c'])
    expect(unknownPlaceholders('{{customer_name}} {{favourite_colour}}')).toEqual([
      'favourite_colour',
    ])
  })

  it('checks a template before saving', () => {
    const good = {
      key: 'winter_tips',
      name: 'Winter tips',
      purpose: 'marketing' as const,
      subject: 'Save power, {{customer_name}}',
      body: 'Hello',
      isActive: true,
    }
    expect(validateTemplate(good, true)).toEqual({})
    expect(validateTemplate({ ...good, key: 'Winter Tips' }, true).key).toBeTruthy()
    expect(validateTemplate({ ...good, key: 'Winter Tips' }, false).key).toBeUndefined()
    expect(validateTemplate({ ...good, body: 'Hi {{nickname}}' }, true).body).toMatch(/nickname/)
  })
})

describe('writing an email', () => {
  it('needs a subject and message with every placeholder filled', () => {
    expect(validateEmail('', '').subject).toBeTruthy()
    expect(validateEmail('Hi', 'Due {{due_date}}').body).toMatch(/due_date/)
    expect(validateEmail('Hi', 'All good')).toEqual({})
  })

  it('explains why a customer cannot be emailed', () => {
    expect(whyNotEmail(prefs, 'transactional')).toBeNull()
    expect(whyNotEmail({ ...prefs, email: null }, 'transactional')).toMatch(/no email address/)
    expect(whyNotEmail({ ...prefs, emailOptOut: true }, 'transactional')).toMatch(/asked not/)
    expect(whyNotEmail(prefs, 'marketing')).toMatch(/consent/)
    expect(whyNotEmail({ ...prefs, marketingConsent: true }, 'marketing')).toBeNull()
    expect(
      whyNotEmail({ ...prefs, suppressedAt: 'x', suppressedReason: 'bounced' }, 'transactional'),
    ).toMatch(/bounced/)
    expect(
      whyNotEmail({ ...prefs, suppressedAt: 'x', suppressedReason: 'complained' }, 'transactional'),
    ).toMatch(/spam/)
  })
})
