# Communications: email through Resend

Rules live in `supabase/migrations/20261127000012_communications.sql`; sending lives in `api/` (Vercel
functions). Email is the only channel that sends today. SMS and WhatsApp are covered at the end.

## How an email travels

1. A team member writes an email: from a customer's profile, an invoice (with the PDF attached) or a
   support ticket. Templates fill in the customer's name, invoice number and so on.
2. The database **queues** it. It checks the customer has an email address, has not opted out, has not
   bounced or complained, and has marketing consent if the email is marketing. The recipient is always
   the customer's own address on file.
3. The browser asks the server (`/api/messages/send`) to send it. The server checks the person is staff
   in that business, **claims** the email, sends it through Resend and records the result.
4. Resend later reports **delivered**, **delayed**, **bounced** or **marked as spam** to
   `/api/webhooks/resend`. The server checks the report's signature before recording it.

Nobody signed in can mark an email as sent or delivered, or write delivery history; only the server can.
Every email, call and note is in **Communications**, and on the customer's profile.

## Failures and retries

| What went wrong                                    | What happens                                   |
| -------------------------------------------------- | ---------------------------------------------- |
| Network error, Resend busy (429) or down (5xx)     | Tried again after 1, 5, 15 and 60 minutes      |
| Resend refuses it (bad address, domain not verified, bad key) | Marked failed; waits for a person   |
| Five attempts used                                 | Marked failed; waits for a person              |
| Customer opted out or bounced since it was queued  | Cancelled, not sent                            |
| The server stopped mid-send                        | Picked up again after 10 minutes               |

- **Never sent twice:** each send carries an idempotency key (the email and its address). If a retry
  follows a send that actually went through, Resend does not send it again.
- A person can **Try Again** on a failed email (it goes to the customer's current address) or **Cancel**
  one that has not gone.
- Retries run when anyone next sends an email, and once a day from Vercel Cron (the most the free Vercel
  plan allows). On a paid plan, change the schedule in `vercel.json` to every 15 minutes.

## Consent and preferences (POPIA)

- **Service messages** (invoices, payment reminders, ticket updates) go to every customer with an
  address, unless they have asked for no email (**Does not want email** on their profile).
- **Marketing** templates only send to customers with **Agreed to receive marketing email** ticked. The
  change is recorded with who made it and when. Only tick it when the customer has said yes, and keep the
  evidence (a form or an email).
- A **bounce** stops email to that address until the address changes. A **spam complaint** opts the
  customer out and removes marketing consent.
- Marketing emails must tell people how to opt out (for example "Reply STOP to stop these emails").
  Include that in any marketing template.

## Templates

Managers edit templates under **Communications → Templates**. Placeholders:

`{{customer_name}}` `{{business_name}}` `{{sender_name}}` `{{message}}` `{{invoice_number}}`
`{{invoice_total}}` `{{balance_due}}` `{{due_date}}` `{{ticket_reference}}` `{{ticket_subject}}`

An unknown placeholder is refused when saving, and an email cannot be sent with one left unfilled.

## Setting it up (once)

You need: a Resend account, access to your domain's DNS, and access to Vercel and Supabase.

1. **Run the migration** `20261127000012_communications.sql` in the Supabase SQL editor (after 0011).
2. **Resend:** sign up at resend.com. Under **Domains**, add your domain (for example `umbane.co.za`)
   and add the DNS records it shows at your domain host. Wait until it shows **Verified**.
3. **Resend API key:** under **API Keys**, create a key with **Sending access**.
4. **Supabase service key:** Supabase → Project Settings → API → copy the `service_role` key. It can do
   anything in your database: only ever paste it into Vercel, never into the app or a chat.
5. **Vercel → Project → Settings → Environment Variables**, for Production (and Preview if you want to
   test there):

   | Name                        | Value                                                    |
   | --------------------------- | -------------------------------------------------------- |
   | `RESEND_API_KEY`            | the key from step 3                                      |
   | `EMAIL_FROM`                | e.g. `Umbane <accounts@umbane.co.za>` (on your verified domain) |
   | `EMAIL_REPLY_TO`            | optional, e.g. `support@umbane.co.za`                    |
   | `SUPABASE_SERVICE_ROLE_KEY` | the key from step 4                                      |
   | `CRON_SECRET`               | any long random text (for the daily retry run)           |

   `SUPABASE_URL` is optional: the server uses `VITE_SUPABASE_URL` if it is not set.
6. **Delivery reports:** in Resend → **Webhooks**, add an endpoint
   `https://<your Vercel domain>/api/webhooks/resend` with the events `email.sent`, `email.delivered`,
   `email.delivery_delayed`, `email.bounced` and `email.complained`. Copy its signing secret (it starts
   with `whsec_`) into Vercel as `RESEND_WEBHOOK_SECRET`.
7. **Redeploy** in Vercel so the functions pick up the settings. Communications shows "Email is not set
   up yet" with the missing names until everything is in place.

### Testing before real customers

Resend accepts these test addresses, which simulate an outcome without emailing anyone:
`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`. Give a test customer one of them,
send an email, and check Communications shows Delivered, Bounced or Marked as spam (and that the bounced
or complaining test customer is then blocked).

## SMS and WhatsApp (investigated, not built)

The message history already records SMS and WhatsApp as channels (staff can log them by hand). Sending
them needs a provider module next to `api/_lib/resend.ts` and the same queue, retry and webhook steps.

**SMS (South Africa):** BulkSMS, Clickatell and SMSPortal are local, pay-as-you-go and offer REST APIs
with delivery reports; Twilio works but usually costs more per South African message. Expect to buy
credits up front. Each needs an account, an API key in Vercel, and a sender name or number. SMS marketing
needs the same consent as email, and every message must offer an opt-out.

**WhatsApp Business Platform (Meta Cloud API):**

- Meta must verify the business (company documents; days to weeks), and you need a phone number not
  already used on WhatsApp.
- Messages Umbane starts (invoice ready, ticket update) must use **templates approved by Meta**. Free text
  is only allowed within 24 hours of the customer messaging you.
- Meta charges per conversation, by category (utility, marketing, service) and country.
- Customers must have opted in to WhatsApp messages from you.
- Delivery and read receipts arrive by webhook, like Resend's.

Recommendation: run email for a while, then add WhatsApp for ticket updates (customers in South Africa
read WhatsApp more than email), starting Meta's business verification early because it takes the
longest.
