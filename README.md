# Umbane CRM

[![CI](https://github.com/eliasmtisie4321/UMBANE2026/actions/workflows/ci.yml/badge.svg)](https://github.com/eliasmtisie4321/UMBANE2026/actions/workflows/ci.yml)

**Bringing customers, properties and business operations together.** A CRM for South African
businesses that manage electricity metering for residential, commercial and industrial properties:
customers and properties, meters and readings, sales, invoices and payments, stock, support tickets,
team work, communication on every channel, and reports, in one place.

**Live:** https://umbane2026.vercel.app

![Manager dashboard](docs/screenshots/dash-manager-desktop.png)

## Features

| Area                          | What it does                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customers and properties      | Individual and business customers, properties, consent (email, SMS, WhatsApp, marketing), POPIA erasure on request                               |
| Electricity and meters        | Meters per property, readings with unusual-use flags, consumption, maintenance, replacement and retirement                                       |
| Leads, sales and orders       | Lead pipeline, conversion to customers, orders that take stock when fulfilled                                                                    |
| Invoices and payments         | Numbered tax invoices with VAT, PDF, part payments, overdue tracking                                                                             |
| Inventory                     | Products, stock movements, low-stock alerts                                                                                                      |
| Support tickets               | Customer portal, assignment, status history, attachments, internal notes                                                                         |
| Team and tasks                | Employees and access levels, invitations by email, tasks with proof of work                                                                      |
| Calendar                      | Appointments, task due dates, maintenance and invoice due dates by month or as an agenda; each person's own Google Calendar                      |
| Communications                | One history for email, SMS, WhatsApp and social posts, templates, delivery reports, retries                                                      |
| Integrations                  | Settings → Integrations: Resend, Gmail / Google Workspace, Outlook / Microsoft 365, Twilio SMS, WhatsApp Business, Facebook, Instagram, LinkedIn |
| Sharing                       | One Share dialog everywhere: several platforms at once, preview, delivery status                                                                 |
| Marketing                     | Public posts to the business's social pages                                                                                                      |
| Reports                       | Overview, customers, properties, electricity, sales, revenue, inventory, support, team; CSV and PDF                                              |
| Notifications and automations | In-app and email notifications; overdue-invoice, task and maintenance reminders                                                                  |
| Settings and audit            | Business profile, invoice and tax settings, categories, roles, audit log, data retention                                                         |
| Search and Quick Add          | Search every record the person may see from the top bar; Quick Add opens the create pages their role allows                                      |

Four roles: administrator, manager, staff and client, each limited by the database itself
(`docs/PERMISSIONS.md`).

## Screenshots

Every screen, filled with made-up example records: none of them are real customers. Desktop pictures
show the whole page at 1440 pixels wide; phone pictures show the first screen at 390. Select a picture
to see it full size.

[Signing in and your account](#signing-in-and-your-account) · [Dashboard](#dashboard) · [Search, Quick Add and the clock](#search-quick-add-and-the-clock) · [Customers and properties](#customers-and-properties) · [Electricity and meters](#electricity-and-meters) · [Leads, sales and orders](#leads-sales-and-orders) · [Invoices and payments](#invoices-and-payments) · [Inventory](#inventory) · [Support tickets](#support-tickets) · [Team and tasks](#team-and-tasks) · [Calendar](#calendar) · [Communications, sharing and integrations](#communications-sharing-and-integrations) · [Reports](#reports) · [Notifications and automations](#notifications-and-automations) · [Settings and audit](#settings-and-audit) · [On a phone](#on-a-phone)

### Signing in and your account

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/login-desktop.png" width="280" alt="Sign in"><br>Sign in</td>
    <td valign="top"><img src="docs/screenshots/create-account.png" width="280" alt="Asking for an account"><br>Asking for an account</td>
    <td valign="top"><img src="docs/screenshots/forgot-desktop.png" width="280" alt="Forgotten password"><br>Forgotten password</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/reset-password.png" width="280" alt="Choosing a new password"><br>Choosing a new password</td>
    <td valign="top"><img src="docs/screenshots/welcome.png" width="280" alt="Accepting an invitation"><br>Accepting an invitation</td>
    <td valign="top"><img src="docs/screenshots/account-security.png" width="280" alt="Account security"><br>Account security</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/not-found.png" width="280" alt="A page that does not exist"><br>A page that does not exist</td>
  </tr>
</table>

### Dashboard

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/dash-manager-desktop.png" width="280" alt="Manager dashboard"><br>Manager dashboard</td>
    <td valign="top"><img src="docs/screenshots/dash-client-desktop.png" width="280" alt="Client dashboard"><br>Client dashboard</td>
  </tr>
</table>

### Search, Quick Add and the clock

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/search.png" width="280" alt="Searching everything from the top bar"><br>Searching everything from the top bar</td>
    <td valign="top"><img src="docs/screenshots/quick-add.png" width="280" alt="Quick Add"><br>Quick Add</td>
  </tr>
</table>

### Customers and properties

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/crm-customers.png" width="280" alt="Customers"><br>Customers</td>
    <td valign="top"><img src="docs/screenshots/crm-customer-profile.png" width="280" alt="Customer profile"><br>Customer profile</td>
    <td valign="top"><img src="docs/screenshots/crm-customer-new.png" width="280" alt="New customer, with its checks"><br>New customer, with its checks</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/crm-customer-confirm.png" width="280" alt="Confirming changes to a customer"><br>Confirming changes to a customer</td>
    <td valign="top"><img src="docs/screenshots/crm-properties.png" width="280" alt="Properties"><br>Properties</td>
    <td valign="top"><img src="docs/screenshots/crm-property-detail.png" width="280" alt="Property"><br>Property</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/crm-property-new.png" width="280" alt="New property"><br>New property</td>
  </tr>
</table>

### Electricity and meters

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/meters.png" width="280" alt="Meters"><br>Meters</td>
    <td valign="top"><img src="docs/screenshots/meter-detail.png" width="280" alt="Meter, with consumption and readings"><br>Meter, with consumption and readings</td>
    <td valign="top"><img src="docs/screenshots/meter-new.png" width="280" alt="New meter"><br>New meter</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/meter-reading.png" width="280" alt="Recording a reading"><br>Recording a reading</td>
    <td valign="top"><img src="docs/screenshots/maintenance.png" width="280" alt="Maintenance work orders"><br>Maintenance work orders</td>
    <td valign="top"><img src="docs/screenshots/maintenance-dialog.png" width="280" alt="Updating a work order"><br>Updating a work order</td>
  </tr>
</table>

### Leads, sales and orders

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/leads.png" width="280" alt="Lead pipeline"><br>Lead pipeline</td>
    <td valign="top"><img src="docs/screenshots/lead-detail.png" width="280" alt="Lead"><br>Lead</td>
    <td valign="top"><img src="docs/screenshots/lead-new.png" width="280" alt="New lead"><br>New lead</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/lead-convert.png" width="280" alt="Converting a lead to a customer"><br>Converting a lead to a customer</td>
    <td valign="top"><img src="docs/screenshots/orders.png" width="280" alt="Sales orders"><br>Sales orders</td>
    <td valign="top"><img src="docs/screenshots/order-new.png" width="280" alt="New order"><br>New order</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/order-detail.png" width="280" alt="Order"><br>Order</td>
  </tr>
</table>

### Invoices and payments

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/invoices.png" width="280" alt="Invoices"><br>Invoices</td>
    <td valign="top"><img src="docs/screenshots/invoice-detail.png" width="280" alt="Invoice"><br>Invoice</td>
    <td valign="top"><img src="docs/screenshots/invoice-new.png" width="280" alt="New invoice"><br>New invoice</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/invoice-pay.png" width="280" alt="Recording a payment"><br>Recording a payment</td>
    <td valign="top"><img src="docs/screenshots/invoice-pdf.png" width="280" alt="Invoice PDF"><br>Invoice PDF</td>
    <td valign="top"><img src="docs/screenshots/payments.png" width="280" alt="Payment history"><br>Payment history</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/invoice-settings.png" width="280" alt="Invoice and tax settings"><br>Invoice and tax settings</td>
  </tr>
</table>

### Inventory

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/inventory.png" width="280" alt="Products and stock"><br>Products and stock</td>
    <td valign="top"><img src="docs/screenshots/product-detail.png" width="280" alt="Product"><br>Product</td>
    <td valign="top"><img src="docs/screenshots/product-new.png" width="280" alt="New product"><br>New product</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/stock-movement.png" width="280" alt="Recording a stock movement"><br>Recording a stock movement</td>
    <td valign="top"><img src="docs/screenshots/inventory-history.png" width="280" alt="Stock history"><br>Stock history</td>
  </tr>
</table>

### Support tickets

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/support-tickets.png" width="280" alt="Support tickets"><br>Support tickets</td>
    <td valign="top"><img src="docs/screenshots/support-ticket-detail.png" width="280" alt="Ticket, with the conversation"><br>Ticket, with the conversation</td>
    <td valign="top"><img src="docs/screenshots/support-ticket-new.png" width="280" alt="New ticket"><br>New ticket</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/support-ticket-assign.png" width="280" alt="Assigning a ticket"><br>Assigning a ticket</td>
    <td valign="top"><img src="docs/screenshots/support-ticket-resolve.png" width="280" alt="Resolving a ticket"><br>Resolving a ticket</td>
    <td valign="top"><img src="docs/screenshots/support-client-tickets.png" width="280" alt="Client portal: their tickets"><br>Client portal: their tickets</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/support-client-detail.png" width="280" alt="Client portal: a ticket"><br>Client portal: a ticket</td>
  </tr>
</table>

### Team and tasks

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/team-team.png" width="280" alt="Team, with invitations waiting"><br>Team, with invitations waiting</td>
    <td valign="top"><img src="docs/screenshots/team-employee.png" width="280" alt="Employee"><br>Employee</td>
    <td valign="top"><img src="docs/screenshots/team-employee-new.png" width="280" alt="New employee"><br>New employee</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/team-employee-invited.png" width="280" alt="Invitation emailed"><br>Invitation emailed</td>
    <td valign="top"><img src="docs/screenshots/team-tasks.png" width="280" alt="Tasks"><br>Tasks</td>
    <td valign="top"><img src="docs/screenshots/team-task-detail.png" width="280" alt="Task, with updates and proof of work"><br>Task, with updates and proof of work</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/team-task-new.png" width="280" alt="New task"><br>New task</td>
  </tr>
</table>

### Calendar

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/calendar.png" width="280" alt="Month, with Google Calendar"><br>Month, with Google Calendar</td>
    <td valign="top"><img src="docs/screenshots/calendar-agenda.png" width="280" alt="Agenda"><br>Agenda</td>
    <td valign="top"><img src="docs/screenshots/calendar-event.png" width="280" alt="An appointment, copied to Google"><br>An appointment, copied to Google</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/calendar-new.png" width="280" alt="New appointment"><br>New appointment</td>
    <td valign="top"><img src="docs/screenshots/calendar-connect.png" width="280" alt="Before Google Calendar is connected"><br>Before Google Calendar is connected</td>
  </tr>
</table>

### Communications, sharing and integrations

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/comms-communications.png" width="280" alt="Message history"><br>Message history</td>
    <td valign="top"><img src="docs/screenshots/comms-message-failed.png" width="280" alt="A failed message and its retries"><br>A failed message and its retries</td>
    <td valign="top"><img src="docs/screenshots/comms-customer.png" width="280" alt="A customer’s messages and consent"><br>A customer’s messages and consent</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/comms-compose.png" width="280" alt="Sending a message on several channels"><br>Sending a message on several channels</td>
    <td valign="top"><img src="docs/screenshots/comms-templates.png" width="280" alt="Templates"><br>Templates</td>
    <td valign="top"><img src="docs/screenshots/comms-template-edit.png" width="280" alt="Editing a template"><br>Editing a template</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/comms-communications-not-set-up.png" width="280" alt="When email is not set up yet"><br>When email is not set up yet</td>
    <td valign="top"><img src="docs/screenshots/marketing.png" width="280" alt="Marketing posts"><br>Marketing posts</td>
    <td valign="top"><img src="docs/screenshots/marketing-share.png" width="280" alt="Posting to several platforms at once"><br>Posting to several platforms at once</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/settings-integrations.png" width="280" alt="Settings → Integrations"><br>Settings → Integrations</td>
  </tr>
</table>

### Reports

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/reports.png" width="280" alt="Reports overview"><br>Reports overview</td>
    <td valign="top"><img src="docs/screenshots/reports-revenue.png" width="280" alt="Revenue"><br>Revenue</td>
    <td valign="top"><img src="docs/screenshots/reports-sales.png" width="280" alt="Sales"><br>Sales</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/reports-customers.png" width="280" alt="Customers"><br>Customers</td>
    <td valign="top"><img src="docs/screenshots/reports-properties.png" width="280" alt="Properties"><br>Properties</td>
    <td valign="top"><img src="docs/screenshots/reports-electricity.png" width="280" alt="Electricity"><br>Electricity</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/reports-inventory.png" width="280" alt="Inventory"><br>Inventory</td>
    <td valign="top"><img src="docs/screenshots/reports-support.png" width="280" alt="Support"><br>Support</td>
    <td valign="top"><img src="docs/screenshots/reports-team.png" width="280" alt="Team"><br>Team</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/reports-custom-range.png" width="280" alt="A custom period, checked"><br>A custom period, checked</td>
  </tr>
</table>

### Notifications and automations

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/notifications.png" width="280" alt="Notifications"><br>Notifications</td>
    <td valign="top"><img src="docs/screenshots/notification-settings.png" width="280" alt="Notification settings"><br>Notification settings</td>
    <td valign="top"><img src="docs/screenshots/automations.png" width="280" alt="Automations"><br>Automations</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/automation-detail.png" width="280" alt="An automation and its history"><br>An automation and its history</td>
  </tr>
</table>

### Settings and audit

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/settings.png" width="280" alt="Settings"><br>Settings</td>
    <td valign="top"><img src="docs/screenshots/settings-business.png" width="280" alt="Business profile"><br>Business profile</td>
    <td valign="top"><img src="docs/screenshots/settings-categories.png" width="280" alt="Categories"><br>Categories</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/settings-roles.png" width="280" alt="Roles and what each can do"><br>Roles and what each can do</td>
    <td valign="top"><img src="docs/screenshots/settings-privacy.png" width="280" alt="Data and privacy"><br>Data and privacy</td>
    <td valign="top"><img src="docs/screenshots/settings-audit.png" width="280" alt="Audit log"><br>Audit log</td>
  </tr>
</table>

### On a phone

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/login-mobile.png" width="150" alt="Sign in"><br>Sign in</td>
    <td valign="top"><img src="docs/screenshots/dash-manager-mobile.png" width="150" alt="Dashboard"><br>Dashboard</td>
    <td valign="top"><img src="docs/screenshots/crm-customers-mobile.png" width="150" alt="Customers"><br>Customers</td>
    <td valign="top"><img src="docs/screenshots/meters-mobile.png" width="150" alt="Meters"><br>Meters</td>
    <td valign="top"><img src="docs/screenshots/meter-detail-mobile.png" width="150" alt="Meter"><br>Meter</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/meter-reading-mobile.png" width="150" alt="Recording a reading"><br>Recording a reading</td>
    <td valign="top"><img src="docs/screenshots/meter-retire-mobile.png" width="150" alt="Retiring a meter"><br>Retiring a meter</td>
    <td valign="top"><img src="docs/screenshots/maintenance-mobile.png" width="150" alt="Maintenance"><br>Maintenance</td>
    <td valign="top"><img src="docs/screenshots/leads-mobile.png" width="150" alt="Leads"><br>Leads</td>
    <td valign="top"><img src="docs/screenshots/lead-detail-mobile.png" width="150" alt="Lead"><br>Lead</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/orders-mobile.png" width="150" alt="Orders"><br>Orders</td>
    <td valign="top"><img src="docs/screenshots/order-new-mobile.png" width="150" alt="New order"><br>New order</td>
    <td valign="top"><img src="docs/screenshots/order-detail-mobile.png" width="150" alt="Order"><br>Order</td>
    <td valign="top"><img src="docs/screenshots/invoices-mobile.png" width="150" alt="Invoices"><br>Invoices</td>
    <td valign="top"><img src="docs/screenshots/invoice-detail-mobile.png" width="150" alt="Invoice"><br>Invoice</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/inventory-mobile.png" width="150" alt="Inventory"><br>Inventory</td>
    <td valign="top"><img src="docs/screenshots/support-tickets-mobile.png" width="150" alt="Support tickets"><br>Support tickets</td>
    <td valign="top"><img src="docs/screenshots/support-ticket-detail-mobile.png" width="150" alt="Ticket"><br>Ticket</td>
    <td valign="top"><img src="docs/screenshots/support-client-new.png" width="150" alt="Client: reporting a problem"><br>Client: reporting a problem</td>
    <td valign="top"><img src="docs/screenshots/team-team-mobile.png" width="150" alt="Team"><br>Team</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/team-tasks-staff-mobile.png" width="150" alt="Staff: their tasks"><br>Staff: their tasks</td>
    <td valign="top"><img src="docs/screenshots/team-task-detail-staff-mobile.png" width="150" alt="Staff: a task"><br>Staff: a task</td>
    <td valign="top"><img src="docs/screenshots/calendar-mobile.png" width="150" alt="Calendar"><br>Calendar</td>
    <td valign="top"><img src="docs/screenshots/comms-communications-mobile.png" width="150" alt="Communications"><br>Communications</td>
    <td valign="top"><img src="docs/screenshots/reports-mobile.png" width="150" alt="Reports"><br>Reports</td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/screenshots/reports-revenue-mobile.png" width="150" alt="Revenue report"><br>Revenue report</td>
    <td valign="top"><img src="docs/screenshots/automations-mobile.png" width="150" alt="Automations"><br>Automations</td>
    <td valign="top"><img src="docs/screenshots/settings-audit-mobile.png" width="150" alt="Audit log"><br>Audit log</td>
    <td valign="top"><img src="docs/screenshots/create-account-mobile.png" width="150" alt="Asking for an account"><br>Asking for an account</td>
  </tr>
</table>

The designs the screens follow (Google Stitch) are in [`docs/designs/`](docs/designs/).

## How it is built

React 19, TypeScript, Vite and Tailwind CSS in the browser; Supabase (Postgres with row security on
every table, Auth, Storage) as the system of record; Vercel for hosting, server functions and the
daily cron. The browser only has the public anon key; secrets live in Vercel and are used by the
server functions only. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the diagram.

## Getting access

There are no public demo logins. People join by:

- **Create account** on the sign-in page: sends an access request that a manager approves, or
- an **invitation** from an administrator (Team → Add Employee), which arrives by email.

## Running it locally

Requirements: Node.js 22.12+ (`.nvmrc`).

```bash
npm ci
cp .env.example .env   # public Supabase values only
npm run dev            # http://localhost:5173
```

`.env` only ever holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public). The server
functions in `api/` need their own settings (service-role key, provider keys); they run on Vercel,
or locally with `vercel dev`. Every setting is listed in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)
and [`docs/LAUNCH.md`](docs/LAUNCH.md). Never commit secrets or Supabase service-role keys.

## Commands

| Command                           | What it does                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Development server                                                                                      |
| `npm run lint`                    | ESLint                                                                                                  |
| `npm run format` / `format:check` | Prettier                                                                                                |
| `npm run typecheck`               | TypeScript (app, server, end-to-end)                                                                    |
| `npm test`                        | Unit, screen and server tests (Vitest)                                                                  |
| `npm run test:db`                 | Every migration on an in-memory Postgres, then the row-security and rules tests                         |
| `npm run test:e2e`                | Playwright on the built app: journeys, layouts, accessibility (`npx playwright install chromium` first) |
| `npm run build`                   | Production build                                                                                        |
| `npm run verify:prod`             | Read-only check of the live site, server functions and database                                         |

## Documentation

| Topic                          |                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture                   | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                                                                                                                                                                                                                                                                                        |
| Launch, operations, backups    | [`docs/LAUNCH.md`](docs/LAUNCH.md)                                                                                                                                                                                                                                                                                                    |
| Release notes and test results | [`docs/RELEASE.md`](docs/RELEASE.md)                                                                                                                                                                                                                                                                                                  |
| Settings and migrations        | [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)                                                                                                                                                                                                                                                                                          |
| Roles and permissions          | [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)                                                                                                                                                                                                                                                                                          |
| Testing, security, performance | [`docs/QA.md`](docs/QA.md)                                                                                                                                                                                                                                                                                                            |
| Integrations and sharing       | [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)                                                                                                                                                                                                                                                                                        |
| Modules                        | [`METERS`](docs/METERS.md) · [`SALES`](docs/SALES.md) · [`INVOICES`](docs/INVOICES.md) · [`INVENTORY`](docs/INVENTORY.md) · [`SUPPORT`](docs/SUPPORT.md) · [`TEAM`](docs/TEAM.md) · [`COMMUNICATIONS`](docs/COMMUNICATIONS.md) · [`REPORTS`](docs/REPORTS.md) · [`AUTOMATIONS`](docs/AUTOMATIONS.md) · [`SETTINGS`](docs/SETTINGS.md) |
| Conventions                    | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)                                                                                                                                                                                                                                                                                          |
| Plan                           | [`IMPLEMENTATION-v1.1.md`](IMPLEMENTATION-v1.1.md) · [`BUSINESS.md`](BUSINESS.md)                                                                                                                                                                                                                                                     |

## Known issues and limitations

- **Providers need their own approval** before they can be connected: Google (Gmail send and
  Calendar events scopes), Microsoft, Meta (App Review, WhatsApp business verification and
  templates), LinkedIn, Twilio.
  Until then each shows as not connected. Email works through the built-in Resend sender.
- **WhatsApp** free text and documents only go within 24 hours of the customer's last message;
  otherwise an approved template is needed.
- **TikTok**, **direct messages on Facebook, Instagram or LinkedIn**, and **LinkedIn company pages**
  are not supported by those providers' APIs for this use.
- **Retries** run when someone sends, while someone is signed in, and once a day (Vercel's free plan
  allows one cron a day).
- **Password-reset emails** come from Supabase; set custom SMTP for reliable delivery
  (`docs/LAUNCH.md`).
- **Storage files** are not in Supabase's database backups; download them periodically.
- Everything else known is in [`docs/RELEASE.md`](docs/RELEASE.md).

## Troubleshooting

- **Windows:** if `npm test` fails with `Cannot read properties of undefined (reading 'config')`,
  your shell's working directory uses a lowercase drive letter (`c:\...`). Run the tests from a
  shell opened at `C:\...` (uppercase). This does not affect CI.
