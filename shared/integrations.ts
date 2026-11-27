/**
 * Every external provider Umbane can connect to, and what each one's API really supports. One list
 * for the app (what to show and offer) and the server (what to allow). A connection only gets the
 * capabilities its provider confirmed when it was connected (integrations.capabilities); this list
 * is the most it can ever have. The database checks the same provider and capability names
 * (supabase/migrations/20261201000017_integrations.sql); src/services/integrations.test.ts keeps them in step.
 *
 * No imports: this file is compiled for both the browser (src/) and the server (api/).
 */

export type Capability =
  /** Sends email to one recipient. */
  | 'send_email'
  /** Sends a private message (SMS, WhatsApp) to one person. */
  | 'direct_message'
  /** Carries a file with the message itself. */
  | 'attachments'
  /** Carries a document as a private link instead (SMS cannot carry files). */
  | 'document_links'
  /** Publishes a public post on a page or profile. Never used for customer records. */
  | 'publish_social'
  /** Receives replies from customers into the history. */
  | 'receive_messages'
  /** Reports delivered, failed or bounced after sending. */
  | 'delivery_tracking'
  /** Reads and writes events on a person's own calendar. */
  | 'calendar_events'

export const CAPABILITIES: readonly Capability[] = [
  'send_email',
  'direct_message',
  'attachments',
  'document_links',
  'publish_social',
  'receive_messages',
  'delivery_tracking',
  'calendar_events',
]

export const CAPABILITY_LABEL: Record<Capability, string> = {
  send_email: 'Sends email',
  direct_message: 'Direct messages',
  attachments: 'Attachments',
  document_links: 'Document links',
  publish_social: 'Public posts',
  receive_messages: 'Receives replies',
  delivery_tracking: 'Delivery reports',
  calendar_events: 'Calendar events',
}

/** Where a message goes. Direct channels reach one person; social channels publish publicly. */
export type Channel =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  /** Not a messaging channel: a person's own calendar. */
  | 'calendar'
export const DIRECT_CHANNELS: readonly Channel[] = ['email', 'sms', 'whatsapp']
export const SOCIAL_CHANNELS: readonly Channel[] = ['facebook', 'instagram', 'linkedin', 'tiktok']
export const isSocialChannel = (c: Channel) => SOCIAL_CHANNELS.includes(c)

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  calendar: 'Calendar',
}

export type ProviderKey =
  | 'resend'
  | 'google'
  | 'microsoft'
  | 'twilio'
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'google_calendar'

export type ProviderGroup = 'email' | 'messaging' | 'social' | 'calendar'

export const GROUP_LABEL: Record<ProviderGroup, string> = {
  email: 'Email',
  messaging: 'SMS and WhatsApp',
  social: 'Social media',
  calendar: 'Calendars',
}

/** A value the administrator types when connecting (api_key) or changes later (settings). */
export interface Field {
  name: string
  label: string
  /** Secret values are encrypted on the server and never sent back to the browser. */
  secret: boolean
  required: boolean
  hint?: string
  /** A regular expression the value must match (whole value). */
  pattern?: string
  placeholder?: string
  /** A fixed list of choices instead of free text. */
  options?: { value: string; label: string }[]
}

export interface ProviderInfo {
  key: ProviderKey
  label: string
  group: ProviderGroup
  channel: Channel
  /**
   * api_key: the administrator pastes keys from the provider. oauth: they sign in with the provider.
   * unavailable: listed so people know, but the provider's API cannot do what Umbane needs.
   */
  connect: 'api_key' | 'oauth' | 'unavailable'
  /**
   * Personal: each team member connects their own account (a calendar), from the page that uses it.
   * Otherwise the connection belongs to the business and only administrators manage it.
   */
  personal?: boolean
  capabilities: readonly Capability[]
  /** What the business needs to have before it can connect. */
  requirements: string[]
  /** What to type to connect (api_key providers). */
  fields?: Field[]
  /** Non-secret options, changeable after connecting. */
  settings?: Field[]
  /** Server settings (Vercel) an OAuth provider needs: Umbane's own app id and secret there. */
  serverEnv?: string[]
  /** The biggest file the provider accepts with a message, in bytes. */
  maxAttachmentBytes?: number
  /** Most characters in one message or post. */
  maxLength?: number
  /** A post must include an image (Instagram). */
  needsImage?: boolean
  /** Why it cannot be connected (connect: unavailable). */
  unavailableReason?: string
  docsUrl: string
}

const MB = 1024 * 1024
const E164 = '\\+[1-9][0-9]{7,14}'
const EMAIL = '[^@\\s]+@[^@\\s]+\\.[^@\\s]+'

const SENDER_NAME: Field = {
  name: 'fromName',
  label: 'Sender name',
  secret: false,
  required: false,
  hint: 'Shown as who the email is from, e.g. "Umbane Accounts".',
  pattern: '[^<>"\\r\\n]{1,80}',
}
const REPLY_TO: Field = {
  name: 'replyTo',
  label: 'Reply-to address',
  secret: false,
  required: false,
  hint: 'Where replies go, if not the sending address.',
  pattern: EMAIL,
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    key: 'resend',
    label: 'Resend',
    group: 'email',
    channel: 'email',
    connect: 'api_key',
    capabilities: ['send_email', 'attachments', 'delivery_tracking'],
    requirements: [
      'A Resend account with your domain verified (Resend → Domains).',
      'An API key with sending access (Resend → API Keys).',
      'For delivery reports: a webhook in Resend pointing at Umbane, and its signing secret.',
    ],
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        pattern: 're_[A-Za-z0-9_]{8,}',
        placeholder: 're_…',
      },
      {
        name: 'webhookSecret',
        label: 'Webhook signing secret',
        secret: true,
        required: false,
        pattern: 'whsec_[A-Za-z0-9+/=]{8,}',
        placeholder: 'whsec_…',
        hint: 'Optional. Needed for Delivered, Bounced and Spam reports.',
      },
    ],
    settings: [
      {
        name: 'fromAddress',
        label: 'Send from',
        secret: false,
        required: true,
        pattern: EMAIL,
        placeholder: 'accounts@yourdomain.co.za',
        hint: 'An address on your verified Resend domain.',
      },
      SENDER_NAME,
      REPLY_TO,
    ],
    maxAttachmentBytes: 40 * MB,
    docsUrl: 'https://resend.com/docs',
  },
  {
    key: 'google',
    label: 'Gmail / Google Workspace',
    group: 'email',
    channel: 'email',
    connect: 'oauth',
    capabilities: ['send_email', 'attachments'],
    requirements: [
      'A Gmail or Google Workspace account to send from.',
      'Umbane’s Google app (set up once on the server) approved for the Gmail “send” permission.',
    ],
    settings: [SENDER_NAME, REPLY_TO],
    serverEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    maxAttachmentBytes: 25 * MB,
    docsUrl: 'https://developers.google.com/gmail/api/guides/sending',
  },
  {
    key: 'microsoft',
    label: 'Outlook / Microsoft 365',
    group: 'email',
    channel: 'email',
    connect: 'oauth',
    capabilities: ['send_email', 'attachments'],
    requirements: [
      'An Outlook.com or Microsoft 365 mailbox to send from.',
      'Umbane’s Microsoft app (set up once on the server) with the Mail.Send permission; some organisations need an administrator to approve it.',
    ],
    settings: [REPLY_TO],
    serverEnv: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    // Microsoft Graph takes files up to 3 MB inside the send request.
    maxAttachmentBytes: 3 * MB,
    docsUrl: 'https://learn.microsoft.com/graph/api/user-sendmail',
  },
  {
    key: 'twilio',
    label: 'SMS (Twilio)',
    group: 'messaging',
    channel: 'sms',
    connect: 'api_key',
    capabilities: ['direct_message', 'document_links', 'delivery_tracking'],
    requirements: [
      'A Twilio account with credit.',
      'A Twilio phone number or Messaging Service that can send to South African numbers.',
    ],
    fields: [
      {
        name: 'accountSid',
        label: 'Account SID',
        secret: false,
        required: true,
        pattern: 'AC[0-9a-f]{32}',
        placeholder: 'AC…',
      },
      {
        name: 'authToken',
        label: 'Auth token',
        secret: true,
        required: true,
        pattern: '[0-9a-f]{32}',
      },
    ],
    settings: [
      {
        name: 'from',
        label: 'Send from',
        secret: false,
        required: true,
        pattern: `${E164}|MG[0-9a-f]{32}`,
        placeholder: '+27… or MG…',
        hint: 'Your Twilio number, or a Messaging Service SID.',
      },
    ],
    maxLength: 1600,
    docsUrl: 'https://www.twilio.com/docs/messaging',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Business',
    group: 'messaging',
    channel: 'whatsapp',
    connect: 'api_key',
    capabilities: ['direct_message', 'attachments', 'delivery_tracking', 'receive_messages'],
    requirements: [
      'Meta business verification and a WhatsApp Business Account (Meta Business Suite).',
      'A phone number registered on the WhatsApp Business Platform (Cloud API).',
      'A permanent access token from a Meta system user with whatsapp_business_messaging.',
      'For messages Umbane starts: a message template approved by Meta. Free text only works within 24 hours of the customer messaging you.',
    ],
    fields: [
      {
        name: 'phoneNumberId',
        label: 'Phone number ID',
        secret: false,
        required: true,
        pattern: '[0-9]{6,20}',
      },
      {
        name: 'accessToken',
        label: 'Access token',
        secret: true,
        required: true,
        pattern: '[A-Za-z0-9]{40,}',
      },
      {
        name: 'appSecret',
        label: 'App secret',
        secret: true,
        required: false,
        pattern: '[0-9a-f]{32}',
        hint: 'Optional. Needed for delivery reports and customer replies (the Meta app’s secret).',
      },
    ],
    settings: [
      {
        name: 'templateName',
        label: 'Approved template',
        secret: false,
        required: false,
        pattern: '[a-z0-9_]{1,512}',
        hint: 'Used for messages Umbane starts. Its body must have two variables: {{1}} the name, {{2}} the message.',
      },
      {
        name: 'templateLanguage',
        label: 'Template language',
        secret: false,
        required: false,
        pattern: '[a-z]{2}(_[A-Z]{2})?',
        placeholder: 'en',
      },
      {
        name: 'templateHeader',
        label: 'Template header',
        secret: false,
        required: false,
        options: [
          { value: 'none', label: 'None' },
          { value: 'document', label: 'Document (attach the PDF)' },
        ],
      },
    ],
    maxAttachmentBytes: 100 * MB,
    maxLength: 4096,
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  },
  {
    key: 'facebook',
    label: 'Facebook Page',
    group: 'social',
    channel: 'facebook',
    connect: 'oauth',
    capabilities: ['publish_social'],
    requirements: [
      'A Facebook Page you manage.',
      'Umbane’s Meta app (set up once on the server) with pages_manage_posts approved by Meta App Review.',
    ],
    serverEnv: ['META_APP_ID', 'META_APP_SECRET'],
    maxLength: 63206,
    docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    group: 'social',
    channel: 'instagram',
    connect: 'oauth',
    capabilities: ['publish_social'],
    requirements: [
      'An Instagram professional (business or creator) account linked to a Facebook Page.',
      'Umbane’s Meta app with instagram_content_publish approved by Meta App Review.',
      'Every post needs an image at a public https address (Instagram does not take text-only posts).',
    ],
    serverEnv: ['META_APP_ID', 'META_APP_SECRET'],
    maxLength: 2200,
    needsImage: true,
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    group: 'social',
    channel: 'linkedin',
    connect: 'oauth',
    capabilities: ['publish_social'],
    requirements: [
      'A LinkedIn account; posts appear on the profile of the person who connects.',
      'Umbane’s LinkedIn app (set up once on the server) with “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect”.',
      'Posting as a company page needs LinkedIn’s Community Management API approval, which is not included.',
    ],
    serverEnv: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    maxLength: 3000,
    docsUrl:
      'https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin',
  },
  {
    key: 'google_calendar',
    label: 'Google Calendar',
    group: 'calendar',
    channel: 'calendar',
    connect: 'oauth',
    personal: true,
    capabilities: ['calendar_events'],
    requirements: [
      'A Google account with Google Calendar. Each person connects their own, from the Calendar page.',
      'Umbane’s Google app (set up once on the server, the same one as Gmail) with the Google Calendar API turned on and the calendar.events permission approved.',
    ],
    serverEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    group: 'social',
    channel: 'tiktok',
    connect: 'unavailable',
    capabilities: [],
    requirements: [],
    unavailableReason:
      'TikTok’s Content Posting API only accepts videos and photo posts, and only from apps TikTok has audited. Umbane shares text, documents and links, so there is nothing it could post yet.',
    docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
  },
]

/** Providers that can be connected (everything except the unavailable ones). */
export const CONNECTABLE: readonly ProviderKey[] = PROVIDERS.filter(
  (p) => p.connect !== 'unavailable',
).map((p) => p.key)

export function providerInfo(key: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.key === key)
}

/** What kind of message a send is, as the history records it. */
export type MessageType = 'email' | 'direct_message' | 'document_share' | 'social_post' | 'logged'

export const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  email: 'Email',
  direct_message: 'Direct message',
  document_share: 'Document',
  social_post: 'Public post',
  logged: 'Logged by hand',
}

/** Checks one value against a field's rules; returns the problem, or null when it is fine. */
export function fieldProblem(field: Field, value: string | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return field.required ? `Enter the ${field.label.toLowerCase()}.` : null
  if (field.options && !field.options.some((o) => o.value === v))
    return `Choose a ${field.label.toLowerCase()}.`
  if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(v))
    return `This does not look like a valid ${field.label.toLowerCase()}.`
  return null
}
