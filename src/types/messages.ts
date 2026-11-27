export const MESSAGE_STATUSES = [
  { value: 'queued', label: 'Queued' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'complained', label: 'Marked as spam' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'logged', label: 'Logged' },
] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]['value']

export const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'note', label: 'Note' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
] as const
export type Channel = (typeof CHANNELS)[number]['value']
export type Direction = 'inbound' | 'outbound'
export type Purpose = 'transactional' | 'marketing'

export interface MessageListItem {
  id: string
  channel: Channel
  direction: Direction
  status: MessageStatus
  purpose: Purpose
  subject: string | null
  recipient: string | null
  customerId: string | null
  customerName: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  ticketId: string | null
  ticketReference: string | null
  createdByName: string | null
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
  attempts: number
  nextAttemptAt: string | null
  willRetry: boolean
  error: string | null
  /** email, direct_message, document_share, social_post or logged. */
  messageType?: string
  /** The provider it went through (resend, google, twilio, ...). */
  provider?: string | null
  /** The account it went from. */
  sender?: string | null
  recipientName?: string | null
  leadId?: string | null
  leadName?: string | null
  /** Where a published post can be seen. */
  externalUrl?: string | null
}

export interface Message extends MessageListItem {
  body: string | null
  templateKey: string | null
  attachmentName: string | null
  lastEventAt: string | null
}

export interface MessageEvent {
  id: string
  event: string
  detail: Record<string, unknown> | null
  occurredAt: string
}

export interface MessageSummary {
  sentThisMonth: number
  deliveredThisMonth: number
  bouncedThisMonth: number
  waiting: number
  failed: number
}

export interface MessageTemplate {
  id: string
  key: string
  name: string
  purpose: Purpose
  subject: string
  body: string
  isActive: boolean
  updatedAt: string
}

export interface TemplateInput {
  key: string
  name: string
  purpose: Purpose
  subject: string
  body: string
  isActive: boolean
}

export interface EmailInput {
  customerId: string
  subject: string
  body: string
  templateKey: string | null
  purpose: Purpose
  invoiceId?: string | null
  ticketId?: string | null
  attachment?: { path: string; name: string } | null
}

export interface ContactInput {
  customerId: string
  channel: Exclude<Channel, 'email'> | 'email'
  direction: Direction
  subject: string | null
  body: string
}

/** What the server says about email: set up or not, and which setting names are missing. */
export interface EmailSetup {
  email: boolean
  missing: string[]
  deliveryReports: boolean
  retries: boolean
  from: string | null
}

export interface CustomerPreferences {
  email: string | null
  emailOptOut: boolean
  marketingConsent: boolean
  consentUpdatedAt: string | null
  suppressedAt: string | null
  suppressedReason: 'bounced' | 'complained' | null
  /** Asked for no SMS (service messages still go by other channels). */
  smsOptOut?: boolean
  /** Agreed to WhatsApp messages (WhatsApp needs a yes first). */
  whatsappOptIn?: boolean
}
