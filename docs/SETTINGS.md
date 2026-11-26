# Settings, administration and audit

Rules live in `supabase/migrations/20261129000015_settings_admin_audit.sql`. **Settings** in the menu
(managers and administrators) gathers everything below; **Password and sign-in** is in the account menu
for everyone.

| Page | Who | What |
| --- | --- | --- |
| Business profile | Administrators edit; managers view | Name, description, email, phone, website, address |
| Invoice and tax settings | Administrators edit; managers view | VAT, bank details, payment terms, invoice footer |
| Users (Team) | Administrators | Invite, change roles, deactivate |
| Roles and permissions | Managers and administrators | What each of the four roles can do |
| Categories | Managers and administrators | Ticket and product categories |
| Notification preferences | Everyone | In the app and/or by email, per kind |
| Automations | Managers and administrators | See `docs/AUTOMATIONS.md` |
| Password and sign-in | Everyone | Change password; sign out of other devices |
| Audit log | Administrators | Who changed what, and when |
| Data and privacy | Administrators | Retention periods; erasing a customer's details |

## Categories

- **Ticket categories:** every business starts with Meter fault, Prepaid token, Billing, Telemetry,
  Installation and General question. Managers add, rename, switch off or delete them. Customers choose
  from the switched-on ones when they open a ticket.
- **Product categories:** the categories already on products became the starting list. Anyone who may
  add products can type a new category, which joins the list. Managers rename (every product follows),
  switch off or delete them.
- A category in use cannot be deleted, only switched off. Records already in a switched-off category keep
  it and can still be edited; it just cannot be chosen for new ones.

## Audit log

- **What is recorded:**
  - every change to customers, properties, meters, readings, maintenance, leads, orders, sales,
    invoices, payments, products and stock;
  - deleted tickets, tasks and their messages and files;
  - users (including role changes and deactivation), invitations and account requests;
  - the business profile, automations (switch and settings, not each run), email templates and
    categories;
  - password changes and "sign out other devices";
  - customer erasures and the daily clean-up.
- **For each change:** who made it (their name is kept even if they are later removed), when, and which
  fields changed from what to what. ID numbers and bank account numbers are masked (•••087); long text is
  shortened. An update that only touched automatic fields (timestamps, stock totals) is not logged.
- **Who can read it:** administrators only, for their own business. Nobody can change or delete entries;
  only the daily clean-up removes them, after seven years.
- **What managers see instead:** a "Recent activity" panel on the dashboard showing everyday records only,
  without people, settings or security entries.
- **Searching and exporting:** filter by date, area and kind of change, and export what matches (up to
  1,000 entries) as CSV.

## Deactivating someone

On the Team page (administrators). Their access stops at once. They keep their name on everything they
did. The managers are told what is still assigned to them (open tickets, tasks, maintenance visits) so it
can be handed on.

## Data retention

The daily run (`/api/cron/daily`, 08:00 South African time) removes:

| Records | After |
| --- | --- |
| Notifications that were read | 1 year |
| Any notification | 2 years |
| Automation runs and actions | 2 years |
| Approved or declined account requests (and their audit entries) | 1 year |
| Audit log entries | 7 years |

The clean-up logs what it removed in the audit log. Invoices, payments, orders, stock records, customers,
properties, meters, readings, emails, tickets and tasks are business and tax records and are not removed
automatically.

## Erasing a customer's personal details (POPIA)

On the customer's page, administrators choose **Erase Personal Details** and give the reason.

- **Refused while** the customer owes money or has open support tickets.
- **Removed:**
  - name (it becomes "Erased customer" and the first 8 characters of their record number);
  - email, phone numbers, ID and registration numbers, company name, address and notes;
  - the text of their emails and support tickets (closed ones too);
  - their sign-in, which stops working;
  - earlier audit entries that held these details.
- **Kept:** the customer record itself, with invoices, payments, orders, properties, meters and readings.
  Tax law requires these, and they identify the electricity supply.
- **Logged:** the erasure itself, with its reason and who did it.
- **By hand afterwards:**
  - Delete any photos on their tickets.
  - Delete their sign-in account in Supabase → Authentication → Users.
- An erased customer's details cannot be typed back in.

## Setting it up

Run migration **0015** after 0014 in the Supabase SQL editor. Nothing changes in Vercel: the clean-up runs
in the same daily job as the automations (it needs `CRON_SECRET`).
