# Notifications and automations

Rules live in `supabase/migrations/20261129000014_notifications_automations.sql`; the daily run and
email sending live in `api/cron/daily.ts`, `api/notifications/flush.ts` and `api/_lib/notify.ts`.

## Notifications

- Every notification has a kind: **Support tickets**, **Tasks**, **Invoices**, **Inventory**,
  **Customers**, **Maintenance** or **Other**. The Notifications page filters by kind and by read/unread.
- **Notifications → Settings**: each person chooses, for each kind, **In the app**, **By email**, both, or
  neither. Until they choose, everything comes in the app only. Clients see only support tickets and other.
- A notification is never delivered twice for the same thing: automations give each one a key (for
  example "invoice INV-2026-00042 is overdue"), and the same key never reaches the same person again.
- Nobody is notified about their own action (except by automations, which have no "own").

### Notification email

- Sent through Resend from the same address as customer email (`EMAIL_FROM`), with a link to the record
  (`APP_URL`, or the Vercel domain) and a line saying how to switch these emails off.
- Goes out within a few minutes while anyone is using the app (the app asks the server at most once a
  minute), otherwise at the daily run.
- Each email is claimed before sending (two servers never send the same one) and carries an
  idempotency key (a retry after an uncertain failure is not sent twice).
- Temporary failures are retried after 5, 10, 15 and 20 minutes, at most five attempts. A permanent
  failure (bad address) is not retried.
- An email older than two days is not sent (late news is noise), nor one the person no longer wants (they
  switched email off, were deactivated, or have no address).

## Automations

**Automations** in the menu, for managers and administrators. A fixed list: switch each on or off and
change its settings; there is no custom builder yet.

| Automation | When | Then | Starts |
| --- | --- | --- | --- |
| Overdue invoice alerts | An invoice is N days past due, unpaid (default 1) | Notify managers and whoever issued it | On |
| Low stock alerts | A product drops to its reorder level, or runs out | Notify managers (once a day per product at most) | On |
| New customer alerts | A customer is added | Notify managers | On |
| Urgent ticket alerts | A ticket is opened as urgent (already assigned) or raised to urgent | Notify managers | On |
| Task reminders | A task is due within N days (default 1), or becomes overdue | Remind the assignee; when overdue, also whoever set it | On |
| Maintenance reminders | Maintenance is scheduled within N days (default 1) | Remind the technician, or managers if nobody is assigned | On |
| Payment reminders to customers | An invoice is due within N days (default 3), balance above an optional minimum | Email the "Payment reminder" template | **Off** |
| Overdue notices to customers | An invoice is N days past due (default 7) | Email the "Invoice overdue" template | **Off** |
| Ticket updates to customers | The team starts, resolves or closes a ticket | Email the "Support ticket update" template to customers without a login | **Off** |

- **Daily** automations (overdue invoices, task and maintenance reminders, payment reminders, overdue
  notices) run every morning at 08:00 (Vercel Cron, `/api/cron/daily`) and when a manager presses
  **Run Now**. The others act the moment the change happens.
- **Catch-up:** if the daily run is missed, the next run still handles anything that became due in the
  last seven days. Older items are left alone, so switching an automation on does not suddenly alert or
  email about every invoice ever overdue.
- **Customer emails** use the templates under Communications → Templates, go through the Phase 10 email
  queue and all its rules (never to customers who opted out, bounced or complained), and appear in
  Communications. A customer who cannot be emailed is logged as **Skipped** with the reason, once.
- **Never twice:** every action an automation takes is logged with a key (for example "payment reminder
  for INV-2026-00042 due 2 Dec"). A key that succeeded or was skipped is never acted on again, however
  often the automation runs. Two runs at the same moment cannot both act: the second finds the business
  busy.
- **Failures:** a failure on one record is logged with the reason and does not stop the others; it is
  tried again at the next run. An automation that fails as a whole is logged as failed and does not stop
  the other automations. Changes that trigger an instant automation (a sale, a new customer, a ticket
  update) always go ahead, even if the automation fails.
- **History:** each automation's page shows its last 20 runs (done, skipped, failed, any error) and its
  last 50 actions with the record they were about and the outcome.

## Setting it up

1. Run migrations **0012** (if not done) and **0014** in the Supabase SQL editor, in order.
2. In Vercel, set `CRON_SECRET` (any long random text) so the daily run is allowed, and optionally
   `APP_URL`. Email needs the Resend settings from `docs/COMMUNICATIONS.md`; without them, automations
   still run and notify in the app, and emails wait in the queue.
3. Redeploy. Vercel Cron calls `/api/cron/daily` at 06:00 UTC (08:00 in South Africa).
4. Managers: open **Automations**, check the settings, and switch on customer emails when ready.
