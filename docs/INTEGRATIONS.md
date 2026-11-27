# Integrations, sharing and invitations

Every outside service Umbane talks to is connected in **Settings → Integrations** (administrators
only), and everything that sends (Share, Send Message, invitations, notification email) goes through
those connections. There is one system for email, messaging and social media, not one per kind.

Rules live in `supabase/migrations/20261201000017_integrations.sql`; the provider list is
`shared/integrations.ts`; sending is in `api/` (Vercel functions).

## How it fits together

```
Settings → Integrations ──► /api/integrations ──► provider adapter (verify) ──► integrations row
                                    │                                          + integration_secrets
                                    └─ OAuth: sign-in with the provider ─► /api/integrations/callback

Share / Send ──► queue_message() (database: who, consent, links) ──► communication_logs (queued)
                                                                          │
               /api/messages/send ◄──────────────────────────────────────┘
                      │  claim ─► route (connection, default, or built-in email) ─► adapter.send
                      └─ record result ─► communication_logs (sent / failed, provider response)

Provider webhooks ──► /api/webhooks/resend | /api/webhooks/messaging ──► delivered / failed / replies
```

- **Provider registry** (`shared/integrations.ts`): each provider, what it connects with (API keys or
  OAuth), and what its API really supports: send email, direct messages, attachments, document links,
  public posts, receiving replies, delivery reports. The app and the server read the same list; the
  database checks the same names.
- **Adapters** (`api/_lib/integrations/`): one per provider, with the same shape: `verify` (check the
  credentials with the provider and report what this connection can do), `send`, and for OAuth
  `authorizeUrl`, `exchange`, `refresh` and `revoke`.
- **Connections** (`integrations` table): one live connection per provider per business, a default per
  channel, the account it is connected as, and the capabilities the provider **confirmed** (granted
  scopes, configured webhooks), never more than the registry allows. Only the server writes this
  table, and only after the provider has verified the connection. Everyone on the team can read it
  (to choose where to share); it holds no secrets.
- **Credentials** (`integration_secrets`): API keys and OAuth tokens, encrypted with AES-256-GCM by the
  server using `INTEGRATIONS_KEY`, bound to their connection. No signed-in person can read this table,
  not even an administrator. Secrets never reach the browser, local storage or logs.
- **One outbox and history** (`communication_logs`): every message on every channel, with its provider,
  connection, sender, recipient, related record (customer, lead, invoice, ticket, order, report,
  invitation), type (email, direct message, document, public post), share group, delivery status,
  the provider's answer and errors.

## Providers

| Provider                 | Channel   | Connects with                  | What it does in Umbane                                                                         | Needs before it works                                                                                                |
| ------------------------ | --------- | ------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Resend                   | Email     | API key                        | Email with attachments; delivery, bounce and spam reports (with its webhook secret)            | A Resend account with your domain verified                                                                           |
| Gmail / Google Workspace | Email     | Sign in with Google            | Email with attachments, sent from that mailbox                                                 | Umbane's Google OAuth app (server), Google's verification of the `gmail.send` scope for use outside your Workspace   |
| Outlook / Microsoft 365  | Email     | Sign in with Microsoft         | Email with attachments (up to 3 MB each)                                                       | Umbane's Microsoft app (server); some organisations need their admin to approve Mail.Send                            |
| SMS (Twilio)             | SMS       | Account SID + auth token       | Text messages; documents as a private link; delivery reports                                   | A Twilio number or Messaging Service able to send to South Africa, and credit                                        |
| WhatsApp Business        | WhatsApp  | Phone number ID + access token | Messages and documents; delivery reports and customer replies (with the app secret)            | Meta business verification, a Cloud API number, a system-user token, and an approved template for messages you start |
| Facebook Page            | Facebook  | Sign in with Facebook          | Public posts (text, link, image)                                                               | Umbane's Meta app with `pages_manage_posts` approved by Meta App Review                                              |
| Instagram                | Instagram | Sign in with Facebook          | Public posts; each needs an image at a public https address                                    | A professional account linked to a Page; `instagram_content_publish` approved                                        |
| LinkedIn                 | LinkedIn  | Sign in with LinkedIn          | Public posts on the profile of the person who connects                                         | Umbane's LinkedIn app with "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect"                      |
| TikTok                   | –         | Not available                  | Listed so people know: TikTok's posting API only takes video and photo posts from audited apps | –                                                                                                                    |

Some things the providers do not allow, so Umbane does not offer them:

- **No direct messages on Facebook, Instagram or LinkedIn.** Their messaging APIs only reach people
  who wrote to the page first, and CRM customers have no such id. These are for public posts only.
- **WhatsApp outside 24 hours.** Free text and documents only go within 24 hours of the customer's last
  message. Otherwise an approved template is needed (set it under the connection's Settings: body
  variables `{{1}}` the name and `{{2}}` the message; with a document header, the PDF goes too).
  Without one, WhatsApp refuses and Umbane says why.
- **Instagram needs an image** with every post, at a public https address.
- **LinkedIn company pages** need LinkedIn's Community Management API approval, which is not part of
  this build; posts go on the connecting person's profile.
- **Outlook attachments** are limited to 3 MB each by Microsoft's API.

## Connecting

**API-key providers (Resend, Twilio, WhatsApp):** Settings → Integrations → Connect, paste the keys
and options. Umbane checks them with the provider first: Resend confirms the key and that the
sending domain is verified (a sending-only key cannot list domains; then Send Test Email confirms it);
Twilio confirms the account is active and the number is yours; Meta confirms the phone number id
and token. Nothing is saved if the provider refuses.

**OAuth providers (Google, Microsoft, Facebook, Instagram, LinkedIn):** Connect sends the
administrator to the provider's sign-in page. Umbane asks only for what it needs, uses PKCE where the
provider supports it, and a state that works once, for ten minutes, for the administrator who started
it. Back at `/api/integrations/callback`, the server swaps the code for tokens, asks the provider what
was granted, and saves the connection only if the needed permission was given. Tokens are renewed
automatically; if renewal stops working (revoked, expired), the connection shows **Needs attention**
and stops being used until someone connects it again.

**Test** checks a connection again. **Send Test Email** also sends one to the administrator.
**Make Default** chooses which email account is used when several are connected. **Settings**
changes options (sender name, reply-to, WhatsApp template, which Facebook Page or Instagram
account) and checks them again. **Disconnect** deletes the credentials (and revokes the grant with
Google and LinkedIn); messages already sent stay in the history.

### Server settings (Vercel → Settings → Environment Variables)

| Name                                             | What it is                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INTEGRATIONS_KEY`                               | **Required.** 32 random bytes as base64, e.g. from `openssl rand -base64 32`. Encrypts every connection's credentials. Keep a copy somewhere safe: without it, saved connections cannot be read and must be connected again. Never change it casually. |
| `APP_URL`                                        | The app's address, e.g. `https://crm.umbane.co.za`. Needed for OAuth return addresses, webhooks, document links and invitation links.                                                                                                                  |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`       | For Gmail / Google Workspace.                                                                                                                                                                                                                          |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | For Outlook / Microsoft 365 (multi-tenant app, "common").                                                                                                                                                                                              |
| `META_APP_ID`, `META_APP_SECRET`                 | For Facebook and Instagram.                                                                                                                                                                                                                            |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`   | For LinkedIn.                                                                                                                                                                                                                                          |

With each OAuth provider, register the return address `https://<APP_URL>/api/integrations/callback`
(Settings → Integrations shows it). The existing `RESEND_API_KEY` and `EMAIL_FROM` stay as the
**built-in email**, used when a business has no email account connected.

### Webhooks (delivery reports and replies)

Settings → Integrations shows each connection's webhook address:

- **Resend (a business's own account):** `…/api/webhooks/resend?integration=<id>`, with the events
  `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`. Paste
  its signing secret when connecting.
- **Twilio:** nothing to set up; Umbane gives Twilio the status address with each SMS. Reports are
  checked with the connection's auth token.
- **WhatsApp:** in the Meta app → WhatsApp → Configuration, set the callback address and the verify
  token shown, and subscribe to `messages`. Reports and replies are checked with the app secret.

## Sharing and sending

Every Share, Send Message and Share Invoice button opens the same dialog:

1. **Platforms:** the connected ones can be ticked (one or several); the rest say "Not connected"
   with a link to Settings → Integrations (administrators) or "Ask an administrator".
2. **Recipients:** the customer or lead it is about (at the address or number on file), team members
   (reports, documents), and for managers another address for service messages (an accountant). For
   each recipient it shows what is on file and what blocks a channel.
3. **Message:** a template (fills subject and body), the subject for email, the message with the
   limit of the platforms chosen, and the attachment if there is one. SMS gets a private link instead
   of the file (it works for 30 days; cancelling the message switches it off).
4. **Preview:** what each platform will receive.
5. **Send / Publish:** one message per platform per recipient, all in one share, each with an
   idempotency key so a double click or retry never sends twice. The result shows each destination
   (sent, delivered, failed with the reason, or not sent because of consent) with **Try Again** for
   failures.

Where it appears: customer profiles (Send Message), leads (Send Message), sales orders (Share),
invoices (Share Invoice, with the PDF), support tickets (Message Customer), every report (Share,
with the report PDF) and **Marketing** (New Post: public posts to Facebook, Instagram and LinkedIn).

**Direct messages, documents and public posts are kept apart.** A public post can never carry a
customer, an invoice, a ticket, a report or a private file (the database refuses it), and only
managers can publish.

### Consent (POPIA) and preferences

The database checks every message when it is queued and again when it is sent:

- **Email:** as before (opt-out, bounces, spam complaints, marketing consent).
- **SMS:** service messages unless the customer asked for none (**Does not want SMS**).
- **WhatsApp:** only after the customer agreed (**Agreed to WhatsApp messages**), as Meta also requires.
- **Marketing on any channel** needs recorded marketing consent; leads, team members and typed
  addresses never get marketing.
- Consent changes are recorded with who and when, on the customer's profile.

### Failures and retries

The same rules as email (docs/COMMUNICATIONS.md), for every channel. Retries are automatic only
when they cannot send twice: rate limits (the provider did nothing), and temporary failures for
providers that refuse a repeated request (Resend). For the others (Gmail, Outlook, Twilio, WhatsApp,
social), an uncertain failure waits for a person, with "It may have been sent; check before trying
again". A refused message (bad number, no consent, template missing) is never retried by itself.

## Team invitations by email

**Team → Add Employee** now sends the invitation itself:

1. The administrator enters the person's name, email, access level and optional department. The
   database checks they are not already on a team and have no open invitation (`invite_staff`).
2. The server asks **Supabase Auth** for an invitation link (or a sign-in link for an address that has
   an account but never joined), and emails it through the business's email connection or the
   built-in sender. Supabase stays the identity system; the email account only delivers.
3. The person opens the link: Supabase confirms the address and signs them in, the database creates
   their profile from the invitation, and the **Welcome** page asks them to choose a password.

Statuses: **Not sent**, **Sent**, **Failed** (delivery), **Accepted**, **Expired** (after 7 days),
**Cancelled**. On the Team page an administrator can **Resend** (opens it for another week),
**Copy Link** (to share another way; the link signs that person in, so share it only with them)
and **Cancel** (also removes the unused sign-in account the link created). An expired invitation can
be replaced by a new one. The invitation email is in the communication history, without the link.

Supabase's own link lifetime applies (Authentication → Email → OTP expiry; up to 24 hours). The
email says to ask for a new one if it has stopped working; Resend gives a fresh link.

## What is verified, and what needs the providers

Tested automatically (unit, server and database tests): the registry, encryption, every adapter's
requests and error handling against recorded provider responses, OAuth state and PKCE, verification
before saving, webhook signatures, routing, retries, consent rules, row security on every new table,
the Share dialog, the Integrations page, invitations and the Welcome page.

Not yet exercised against the real providers (needs their accounts and approvals):

- Google and Microsoft OAuth apps (client ids and secrets), and Google's verification of `gmail.send`.
- Meta app with Facebook Login, App Review for `pages_manage_posts` and `instagram_content_publish`,
  and business verification for WhatsApp; an approved WhatsApp template.
- LinkedIn app with the two products above.
- A Twilio account with a South African-capable sender.

Until a provider is connected and verified, Umbane shows it as not connected and never offers it.
