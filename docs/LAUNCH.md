# Launch and running Umbane CRM

How the production system is set up, how to check it, how to start using it with real records, and
what to do when something goes wrong. Production is the Supabase project in `.env.example` and the
Vercel project `umbane2026` (https://umbane2026.vercel.app, or your own domain).

## 1. Check the live system

```bash
npm run verify:prod                       # https://umbane2026.vercel.app
npm run verify:prod -- --url https://crm.umbane.co.za
```

It only reads, with the public anon key: the site and deep links, the security headers, that no
server key is in the browser code, that every server function refuses anonymous calls, that every
migration is applied, that visitors see no data, and the sign-in settings. Run it after every deploy
and every migration. Last run (27 November 2026): 44 passed, 1 warning (open sign-up, below), 0 failed.

## 2. Supabase (production project)

**Migrations.** All of `supabase/migrations/` must be applied, in filename order, in the SQL editor.
`verify:prod` lists each one. Never edit a migration that has been applied; add a new one.

**Authentication → URL Configuration**

- Site URL: the app's address (e.g. `https://umbane2026.vercel.app`).
- Redirect URLs: add `<app>/reset-password` and `<app>/welcome` (password reset and team invitations).

**Authentication → Sign In / Providers**

- Turn **off** "Allow new users to sign up". People join through **Create account** (an access request
  a manager approves) or a team invitation; neither needs open sign-up. With it on, anyone can make a
  login (they get no access, but there is no reason to allow it). `verify:prod` warns while it is on.
- Keep "Confirm email" **on**.
- Email OTP expiry (how long invitation and reset links work): 24 hours is the most Supabase allows.

**Authentication → Emails (SMTP).** Supabase's own email service is limited to a few messages an hour.
Password-reset emails come from Supabase: set custom SMTP (for example Resend's SMTP) so they arrive.
Team invitations do not depend on this: Umbane sends them through Settings → Integrations.

**Database → Backups:** see section 7.

## 3. Vercel

**Environment variables (Production):**

| Name                                                                      | Needed for                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                             | The app (public values)                                          |
| `SUPABASE_SERVICE_ROLE_KEY`                                               | All server functions. Never anywhere else                        |
| `APP_URL`                                                                 | Links in emails, invitations, OAuth return address, webhooks     |
| `CRON_SECRET`                                                             | The daily run (automations, retries, retention)                  |
| `INTEGRATIONS_KEY`                                                        | Settings → Integrations (encrypts credentials). Keep a copy safe |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `RESEND_WEBHOOK_SECRET` | The built-in email (optional once an email account is connected) |
| `GOOGLE_*`, `MICROSOFT_*`, `META_*`, `LINKEDIN_*`                         | Each OAuth provider you want to offer (`docs/INTEGRATIONS.md`)   |

After changing variables, **redeploy** (Deployments → … → Redeploy). Only names starting with `VITE_`
reach the browser; never give a secret that prefix.

**Domain:** Settings → Domains. Then update `APP_URL`, Supabase's Site URL and redirect URLs, and
each OAuth provider's return address.

**Rolling back a bad deploy:** Deployments → pick the last good one → **Promote to Production**
(instant). Database changes are not rolled back by this; a migration needs a new migration to undo it.

## 4. The first administrator

Done once, in a new project: create the user in Supabase → Authentication → Users → Add user (tick
Auto Confirm), then run `supabase/bootstrap.sql` with that email. After that, administrators add
everyone else from **Team → Add Employee**: the invitation is emailed and the person sets their own
password. Nobody should share a password, and the bootstrap script is not needed again.

## 5. Starting with real records

There is no sample data: everything in the system is the business's own. A sensible order:

1. **Settings → Business profile** and **Invoice and tax settings** (VAT number, bank details,
   payment terms): these appear on every invoice.
2. **Settings → Integrations:** connect the email account invoices and invitations should come from;
   send a test email. Connect SMS or WhatsApp if you use them.
3. **Settings → Categories:** ticket and product categories.
4. **Team → Add Employee** for each person, with the right access level.
5. **Customers**, then their **Properties**, then **Electricity & Meters** with each meter's
   installation date and first reading. Record consent (email, marketing, SMS, WhatsApp) as customers
   give it.
6. **Inventory:** products and opening stock.
7. **Automations:** switch on the reminders you want (customer emails start off).

Invoice and ticket numbers start at 1 for each year and never repeat, so begin issuing invoices only
once the setup is right.

## 6. Smoke test after launch

`verify:prod` covers what can be checked without signing in. Then, signed in with real accounts:

- [ ] An administrator, a manager, a staff member and a client each sign in and see only their menu.
- [ ] Create a customer, property and meter; record a reading.
- [ ] Create an invoice, issue it, **Share Invoice** by email with the PDF; record a payment; check the
      totals and the PDF.
- [ ] Receive stock, create and fulfil an order; check the stock level.
- [ ] A client opens a ticket with a photo; staff reply and resolve it.
- [ ] Invite a test employee; the invitation arrives, the Welcome page sets a password, they can sign in.
- [ ] A report exports to CSV and PDF, and shares by email.
- [ ] Communications shows each message with its delivery status.
- [ ] On a phone: sign in, open a ticket, view an invoice.

## 7. Backups and recovery (Supabase Pro)

**What is backed up**

- The **database**: Supabase Pro takes a daily backup, kept 7 days (Database → Backups). For a
  recovery point closer than a day, add **Point-in-Time Recovery** (paid add-on).
- **Storage files** (ticket and task attachments, invoice PDFs sent by email) are **not** in database
  backups. Download them from Storage now and then (monthly is reasonable), or with the Supabase CLI.
- **Secrets** are not in any backup: keep `INTEGRATIONS_KEY`, `CRON_SECRET` and the service-role key
  in a password manager. Losing `INTEGRATIONS_KEY` means reconnecting every integration.

**Confirm once, then every quarter**

- [ ] Database → Backups shows a backup from the last 24 hours.
- [ ] Restore a backup into a **new, separate** project and open it with `verify:prod -- --supabase <new url> --key <its anon key>`, then delete it. A backup that was never restored is not known to work.

**Recovering**

| What happened                         | What to do                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bad deploy                          | Promote the last good deployment in Vercel                                                                                                            |
| Records deleted or changed by mistake | Check the audit log first (Settings → Audit log). Restore the backup into a new project and copy the rows back, rather than restoring over production |
| Database lost or corrupted            | Database → Backups → Restore (the project is unavailable during the restore). Then run `verify:prod`                                                  |
| A secret leaked                       | Rotate it: a new service-role key (Supabase → Settings → API), new provider keys (reconnect in Settings → Integrations), new `CRON_SECRET`; redeploy  |
| Someone left                          | Team → their profile → Deactivate. From their next request they can read or change nothing, even if a session is still open                           |

## 8. Keeping it healthy

- Each month: `npm audit` (no known vulnerabilities at launch), check Communications for failed
  messages, and Settings → Integrations for connections that need attention (LinkedIn sign-ins
  expire after about 60 days).
- The daily run is at 06:00 UTC. On Vercel's paid plan, retries can run every 15 minutes
  (`vercel.json` crons).
- New features follow the same path: issue, branch, migration plus tests, pull request, CI, merge,
  run the migration in production, `verify:prod`.
