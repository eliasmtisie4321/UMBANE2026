# Environment configuration

| Variable                  | Where                                                            | Public?                                           |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `VITE_SUPABASE_URL`       | `.env` locally; Vercel project settings for preview + production | Yes                                               |
| `VITE_SUPABASE_ANON_KEY`  | same                                                             | Yes (protected by Row Level Security)             |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel environment variables only, read by the `api/` functions | **Never** in the frontend, `.env.example`, or git |
| `RESEND_API_KEY`          | Vercel only (`api/` functions)                                   | **Never**                                         |
| `RESEND_WEBHOOK_SECRET`   | Vercel only                                                      | **Never**                                         |
| `CRON_SECRET`             | Vercel only                                                      | **Never**                                         |
| `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SUPABASE_URL` | Vercel only                                | Not secret, but server settings                   |

## Local setup

1. `cp .env.example .env`
2. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase → Project Settings → API.
3. `npm run dev`. `.env` is gitignored.

## Environments

- **Local:** `.env`
- **Preview:** Vercel preview environment variables (ideally a separate Supabase branch/project)
- **Production:** Vercel production environment variables

Anything prefixed `VITE_` is bundled into the client, so only put public values there.

## Deployment (Vercel)

- Production: https://umbane2026.vercel.app (deploys from `main`).
- Build: `npm run build`, output `dist`. `vercel.json` rewrites unknown paths to `index.html` so
  client-side routes work on refresh and deep links, except `/api/*`, which are the server functions in
  `api/`. It also schedules the daily email retry run (Vercel Cron).
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview in
  Vercel → Project Settings → Environment Variables. The service-role key goes only in
  `SUPABASE_SERVICE_ROLE_KEY` (never a `VITE_` name, which would put it in the browser). Email settings:
  see `docs/COMMUNICATIONS.md`.

## Supabase Auth settings (required for sign-in and password reset)

In Supabase → Authentication → URL Configuration:

- **Site URL:** `https://umbane2026.vercel.app`
- **Redirect URLs:** add `https://umbane2026.vercel.app/reset-password`, `http://localhost:5173/reset-password`,
  and the Vercel preview pattern if you want reset links to work on previews.

Password reset emails link to `/reset-password`; without these entries Supabase refuses the redirect.
Users are created by an administrator (no public sign-up), so also turn off **Allow new users to sign up**
under Authentication → Providers → Email.

## Windows note

Run dev and tests from a shell whose path starts with an uppercase drive letter (`C:\...`). A lowercase
`c:\...` path can make tools load files twice. The `@/` alias is root-relative to avoid this in Vite.

## Applying database migrations

Migrations in `supabase/migrations/` are applied in filename order. Until a deployment pipeline exists,
apply new ones by pasting the file into the Supabase SQL editor (or with the Supabase CLI).

- `20261125000001_core_schema.sql`, `20261125000002_rls_policies.sql`: schema and security (Phase 1).
- `20261125000003_dashboard_views.sql`: read-only views for the dashboard (invoice balances and summary,
  monthly revenue, stock on hand). They run with the caller's permissions, so existing Row Level Security
  still applies. Until it is applied, dashboard cards that need it show "unavailable until the latest
  database update is applied" and the rest of the dashboard keeps working.

`inventory_transactions.quantity` is signed: positive adds stock, negative removes it. Stock on hand is the sum.

- `20261125000004_customer_property_fields.sql`: the customer and property fields from the designs
  (customer type and segment, ID and registration numbers, address, Pending status, property reference,
  units, status), duplicate protection (unique email, ID number, registration number, property reference,
  and one property per customer and address) and a `business_id` default so the app never sends it.
  Run it before using the Customers and Properties screens against a real project.

- `20261125000005_access_requests.sql`: the "Create Account" button on the login page. It does **not**
  open public sign-up (keep **Allow new users to sign up** off). Visitors call the `request_access()`
  function, which stores a pending request for the first business; anonymous users have no table access.
  Managers and administrators can read and update requests in the `access_requests` table (Table Editor
  for now; there is no review screen yet). To approve one, invite the person from Authentication → Users
  and set their profile role. A request for an email that already has a pending one is ignored.

- `20261125000006_meter_management.sql`: meter fields, reading rules, maintenance, the functions that
  register and retire a meter, and the consumption views (see `docs/METERS.md`). It also ties the
  property, meter and reading links to one business, and fails if existing rows link across businesses.
  Run it before using the Electricity & Meters screens against a real project.

- `20261125000007_sales.sql`: lead and order fields, the rules for stages, conversion, order totals and
  status, sales history and activities (see `docs/SALES.md`). **Run it after 0006.** It renames unknown
  lead sources to "other". Run it before using the Leads and Sales & Orders screens.

- `20261126000008_invoices.sql`: invoice lines, numbering, statuses, payments rules, billing details on the
  business and the invoice views (see `docs/INVOICES.md`). **Run it after 0007.** Existing invoices with the
  status "overdue" become "sent" (overdue is now worked out from the due date). After running it, an
  administrator should fill in Invoices → Settings (VAT number, bank details) before issuing invoices.

- `20261126000009_inventory.sql`: product fields, the stock ledger rules, stock taken by fulfilled orders,
  and the inventory views (see `docs/INVENTORY.md`). **Run it after 0008.** It works out each product's
  stock from the movements already recorded.

- `20261126000010_support_tickets.sql`: ticket rules, references, history, notifications, the private
  `ticket-attachments` storage bucket with its access rules, and the ticket views (see `docs/SUPPORT.md`).
  **Run it after 0009.** Existing tickets without a valid category become "General question". It creates
  the storage bucket itself; nothing needs to be set up in the Storage screen.

- `20261126000011_team_tasks.sql`: employee details, staff invitations, task rules, progress updates,
  the private `task-attachments` storage bucket and the team and task views (see `docs/TEAM.md`).
  **Run it after 0010.** It numbers the existing team in the order they joined. It also adds a trigger on
  Supabase's sign-in accounts so that an invited email gets its profile when it is confirmed.

- `20261127000012_communications.sql`: customer email preferences, message templates, the email outbox
  and delivery history, the private `message-attachments` storage bucket and the server-only sending
  functions (see `docs/COMMUNICATIONS.md`). **Run it after 0011.** Every business gets four starting
  templates.

- `20261128000013_reports.sql`: the report functions behind **Reports** (see `docs/REPORTS.md`). It only
  adds functions; no tables change. **Run it after 0012.**
