# Umbane CRM – Implementation Plan

**Version:** 1.1  
**Status:** Planned / In Development

Build Umbane CRM phase by phase. Every feature should be delivered through **Issue → branch → PR → merge → live verification**. Use TDD where practical: write a failing test, implement the feature, make the test pass, then refactor.

## Development Workflow Rules

1. Create a GitHub Issue with scope and acceptance criteria.
2. Create a branch from the latest `main`.
3. Write or update tests before implementation (red → green → refactor).
4. Use small, clear commits.
5. Open a PR linked to the Issue (`Closes #<issue-number>`).
6. Pass CI before merging.
7. Verify the merged feature on the deployed application.

### Branch names
- `feat/<issue-number>-short-name`
- `fix/<issue-number>-short-name`
- `chore/<issue-number>-short-name`
- `docs/<issue-number>-short-name`

### Commit prefixes
- `feat:` new functionality
- `fix:` bug fixes
- `test:` tests
- `chore:` tooling and maintenance
- `docs:` documentation
- `refactor:` code restructuring

### Pull request and quality rules
- CI must pass lint, typecheck, tests and production build.
- UI changes must be checked against Stitch designs in `docs/designs/` on mobile and desktop.
- Include screenshots or a short demonstration for UI changes.
- Protect `main` with required status checks and PR rules where supported.
- Enforce permissions in the database, not only in the frontend.
- Never commit secrets, service-role keys or private credentials.

Every phase is complete only when its acceptance criteria are met, tests and build pass, the PR is merged, documentation is updated where needed, and the feature is verified on the live application.

---

## Phase 0: Foundation and Deployment

**Goal:** A deployed, empty Umbane CRM application with a working development pipeline.

### 0.1 Repository and project setup
- [x] Confirm the GitHub repository and use `main` as the stable branch.
- [x] Scaffold the React, TypeScript and Vite frontend.
- [ ] Set up the Node.js, Express and TypeScript backend if a separate API server is part of the agreed architecture. _(Deferred: Supabase + RLS is the data layer; see docs/CONVENTIONS.md.)_
- [x] Configure Tailwind CSS and Lucide React icons.
- [x] Add ESLint and Prettier.
- [x] Add Vitest and React Testing Library for unit/component tests.
- [x] Add Playwright for browser-based end-to-end tests.
- [x] Add npm scripts for linting, formatting, typechecking, testing and building.
- [x] Add `.gitignore` and `.env.example`.
- [x] Document the required Node.js version and local setup instructions.

### 0.2 Project structure and standards
- [x] Organize screens, components, layouts, hooks, services, types and utilities.
- [ ] If using Express, separate routes, controllers, middleware, services and database access.
- [x] Establish naming conventions and shared TypeScript types.
- [x] Add consistent API response and error-handling patterns.
- [x] Configure path aliases if useful.

### 0.3 GitHub Actions and CI
- [x] Create a GitHub Actions workflow triggered by pull requests to `main`.
- [x] Install dependencies with `npm ci`.
- [x] Run ESLint.
- [x] Run TypeScript typechecking.
- [x] Run unit and component tests.
- [x] Run the production build.
- [x] Configure branch protection so required checks pass before merge.
- [x] Add a CI status badge to the README when the workflow is stable.

### 0.4 Supabase and environment configuration
- [x] Create the Supabase project.
- [ ] Configure local, preview and production environment variables.
- [x] Add only public client configuration to frontend environment variables.
- [x] Keep privileged keys, including the Supabase service-role key, server-side only.
- [x] Create a version-controlled database migration structure.
- [x] Document how developers configure their `.env` files.

### 0.5 Vercel deployment
- [x] Connect the GitHub repository to Vercel.
- [x] Configure the correct project root and build settings.
- [ ] Add required production environment variables.
- [x] Deploy the initial application.
- [x] Confirm the live URL loads successfully.
- [x] Confirm preview deployments work for branches or PRs.
- [x] Check that secrets are not exposed in client bundles or logs.

### 0.6 Design system foundation
- [x] Store approved Stitch references in `docs/designs/`.
- [x] Extract design tokens for colours, typography, spacing, borders, radii and shadows.
- [x] Build shared UI primitives: button, input, textarea, select, card, badge/chip, modal, table, dropdown and loading indicator.
- [x] Build shared page layout, sidebar, top navigation and responsive navigation.
- [x] Define responsive breakpoints and mobile behaviour.
- [ ] Check keyboard focus, readable contrast and accessible labels.
- [ ] Reuse shared components across screens.

**Phase 0 is done when:**
- [x] The live Umbane URL loads.
- [x] Local setup is documented.
- [x] A PR triggers GitHub Actions.
- [x] CI passes lint, typecheck, tests and build.
- [ ] Supabase and Vercel configuration is documented and secure.
- [x] The initial design system and shared layout are in place.
- [x] `main` is protected by the agreed PR and CI rules.

**Deliverable:** A deployed application foundation ready for feature development.

---

## Phase 1: Authentication, Roles and Database

**Goal:** Users can sign in and access only information and functions permitted by their role.

### Authentication
- [ ] Build the login screen to match the Stitch design.
- [ ] Implement Supabase Authentication.
- [ ] Implement logout and password reset.
- [ ] Add session persistence and expired-session handling.
- [ ] Protect authenticated routes.
- [ ] Handle loading, invalid credentials and session-expiry states.

### Roles and permissions
Initial roles:
- Administrator
- Manager
- Staff
- Client

Tasks:
- [ ] Define what each role can view, create, update and delete.
- [ ] Implement role-based navigation and route guards.
- [ ] Enforce permissions in the database/server, not only by hiding frontend controls.
- [ ] Decide whether Umbane supports multiple businesses/organizations.
- [ ] If multi-business, scope records to a business/organization ID and prevent cross-business access.
- [ ] If single-business, still enforce role-based access and record ownership rules.

### Database schema and migrations
Create version-controlled migrations for the proposed tables:
- [ ] `businesses` or `organizations` (if multi-business support is required)
- [ ] `profiles`
- [ ] `roles` or role assignments
- [ ] `customers`
- [ ] `properties`
- [ ] `electricity_meters`
- [ ] `meter_readings`
- [ ] `leads`
- [ ] `sales`
- [ ] `orders`
- [ ] `order_items`
- [ ] `invoices`
- [ ] `payments`
- [ ] `products`
- [ ] `inventory_transactions`
- [ ] `support_tickets`
- [ ] `ticket_messages`
- [ ] `ticket_attachments`
- [ ] `staff_tasks`
- [ ] `notifications`
- [ ] `communication_logs`
- [ ] `audit_logs`
- [ ] Define primary keys, foreign keys, constraints and indexes.
- [ ] Add created/updated timestamps where appropriate.
- [ ] Define deletion and retention rules for important records.
- [ ] Create seed scripts with realistic demo data.
- [ ] Create test users for each role in a safe development environment.
- [ ] Enable and test Supabase Row Level Security (RLS).
- [ ] Test that users cannot read or modify records outside their permitted business scope or role.

**Done when:** Users sign in, land on the correct role-based experience, and database policies prevent unauthorized access.

---

## Phase 2: Dashboard

**Goal:** Users see a useful overview of the business based on their permissions.

- [ ] Build dashboard layout from Stitch designs. _(Partly done: tiles, revenue chart and lists are built; Customer Growth, Recent Customer Registrations, Outstanding Payments and Upcoming Maintenance panels are not.)_
- [x] Display customer, property and meter totals.
- [ ] Display outstanding invoices and sales summaries. _(Outstanding invoices done; sales and order summaries wait for Phase 5.)_
- [x] Display inventory and low-stock summaries.
- [x] Display open and overdue support tickets. _(Tickets have no due date yet, so "overdue" is shown as open for more than 7 days.)_
- [x] Display recent business activity.
- [x] Add date filters where relevant.
- [x] Implement charts where they add value.
- [x] Add loading, empty and error states.
- [x] Use real database queries rather than hardcoded values.
- [x] Restrict dashboard data according to user permissions.

**Done when:** Authorized users see accurate dashboard information from the database on the live application.

---

## Phase 3: Customer and Property Management

**Goal:** Staff can manage customer records and linked properties.

### Customers
- [x] Create, view and edit customer records. _(Deactivate and reactivate instead of delete, so history is kept. Document upload from the design is not built; it needs file storage.)_
- [x] Store customer contact information.
- [x] Search, sort and filter customers.
- [x] Validate required fields and contact details.
- [x] Display related properties, invoices, orders and tickets.
- [x] Prevent unauthorized access to customer records.

### Properties
- [x] Register and edit properties.
- [x] Link properties to customers.
- [x] Store addresses and property details.
- [x] Search and filter properties.
- [x] Display meters and service history for each property. _(Meters and latest readings. Maintenance added in Phase 4.)_
- [x] Handle duplicate or incomplete records appropriately.

**Done when:** Staff can create a customer, add a property and view the relationship between them.

---

## Phase 4: Electricity and Meter Management

**Goal:** Staff can register meters, record readings and review usage.

- [x] Build electricity management screens. _(Not built: photo upload (needs file storage), live telemetry, rand estimates (no tariff).)_
- [x] Register electricity meters and serial numbers.
- [x] Link meters to properties.
- [x] Track installation dates and meter status.
- [x] Record meter readings with dates.
- [x] Validate readings and flag unusual values. _(Enforced in the database.)_
- [x] Calculate consumption from consecutive readings where applicable.
- [x] Label estimates clearly and document calculation assumptions. _(docs/METERS.md)_
- [x] Display meter reading history.
- [x] Track maintenance, replacement and decommissioning.
- [x] Test consumption calculations and invalid readings.

**Done when:** Staff can register a meter, record readings and view its history and calculated consumption.

---

## Phase 5: Leads, Sales and Orders

**Goal:** Staff can track prospective customers and manage sales.

- [x] Create and edit leads.
- [x] Track lead source, status and assigned staff member.
- [x] Search and filter leads.
- [x] Convert an approved lead into a customer without duplicating records.
- [x] Create sales records and customer orders. _(A sale is recorded when an order is fulfilled; docs/SALES.md)_
- [x] Add products or services to orders.
- [x] Track order status and history.
- [x] Assign sales activities to staff.
- [x] Validate quantities, prices and totals.
- [x] Test lead conversion and order calculations.

**Done when:** A lead can be managed, converted into a customer and linked to an order.

---

## Phase 6: Invoice and Payment Management

**Goal:** Staff can issue invoices and track payments.

- [x] Create invoices for customers and orders.
- [x] Generate unique invoice numbers.
- [x] Add products, services, quantities and prices.
- [x] Calculate subtotals, applicable taxes and totals.
- [x] Define statuses: Draft, Sent, Partially Paid, Paid, Overdue and Cancelled. _(Overdue is worked out from the due date, not stored.)_
- [x] Record payments and payment references.
- [x] Calculate outstanding balances.
- [x] Generate downloadable PDF invoices.
- [x] Store invoice history.
- [x] Send invoices through supported channels when configured. _(No channel is configured yet; Email Customer opens a prefilled email. docs/INVOICES.md)_
- [x] Prevent unauthorized editing of finalized invoices.
- [x] Test totals, partial payments and status transitions.

**Done when:** Staff can create an invoice, record a payment and see the correct outstanding balance.

---

## Phase 7: Inventory and Product Management

**Goal:** Staff can manage products and keep stock quantities accurate.

- [x] Register and edit products.
- [x] Store product names, descriptions, SKU codes and prices.
- [x] Track current stock quantities.
- [x] Record stock received, sold, adjusted or returned.
- [x] Maintain inventory transaction history.
- [x] Configure low-stock thresholds and alerts.
- [x] Connect orders and sales to inventory movements.
- [x] Prevent invalid stock changes.
- [x] Define whether negative stock is allowed. _(Not allowed; docs/INVENTORY.md)_
- [x] Test stock calculations and concurrent updates. _(Calculations tested; concurrency is handled by a row lock but cannot be tested on the single-connection test database.)_

**Done when:** Product quantities update correctly when authorized stock transactions occur.

---

## Phase 8: Customer Support and Ticket Management

**Goal:** Customers can submit support requests and staff can manage them through resolution.

### Customer portal
- [x] Create the customer support portal.
- [x] Allow authenticated clients to submit tickets.
- [x] Capture subject, category, description and related property where applicable.
- [x] Generate unique ticket reference numbers.
- [x] Allow image and document attachments.
- [x] Validate file types and sizes.
- [x] Allow clients to view only their own tickets.
- [x] Display ticket status and response history.

### Staff ticket management
- [x] Display incoming tickets.
- [x] Assign tickets to staff.
- [x] Add internal notes separate from customer-visible messages.
- [x] Allow staff to respond to customers.
- [x] Track status changes and timestamps.
- [x] Filter by status, category, priority and assigned staff.
- [x] Notify relevant users about updates.

Ticket statuses:
- Open
- Assigned
- In Progress
- Resolved
- Closed

**Done when:** A customer submits a ticket, staff respond and update it, and the customer can follow its progress.

---

## Phase 9: Team and Task Management

**Goal:** Managers can coordinate staff and monitor assigned work.

- [x] Create and manage staff profiles.
- [x] Assign tasks with descriptions, priorities and deadlines.
- [x] Track task statuses.
- [x] Link tasks to customers, properties or tickets where relevant.
- [x] Allow staff to add progress updates.
- [x] Support proof-of-work image uploads where needed.
- [x] Track completion dates and responsible staff.
- [x] Restrict task visibility and updates according to role.

**Done when:** A manager can assign a task and track its progress through completion.

---

## Phase 10: Marketing and Communication Integrations

**Goal:** Improve communication with customers through supported channels.

- [x] Store communication history.
- [x] Integrate an email provider for notifications and invoices.
- [x] Investigate and configure WhatsApp Business Platform integration. (Investigated and documented in docs/COMMUNICATIONS.md; not configured, by decision: email first.)
- [x] Select an SMS provider if SMS is required. (Not required for now; options documented.)
- [x] Create reusable message templates.
- [x] Record delivery status and provider responses where available.
- [x] Handle failed messages and retries safely.
- [x] Store API credentials securely on the server.
- [x] Obtain required customer consent and respect communication preferences.
- [ ] Test integrations in provider sandbox/test environments before production.

**Done when:** The selected communication channel works in the deployed environment, with failures handled and logged.

---

## Phase 11: Reports and Analytics

**Goal:** Authorized users can review business performance and export reports.

- [x] Create customer and property reports.
- [x] Create meter and electricity consumption reports.
- [x] Create sales and order reports. _(Sales & invoices report, plus a Team performance report from the designs.)_
- [x] Create invoice and payment reports.
- [x] Create inventory reports.
- [x] Create support ticket reports.
- [x] Add date-range and category filters.
- [x] Add charts where useful.
- [x] Support CSV or PDF exports where appropriate.
- [x] Ensure reports respect permissions and business scope.
- [x] Verify report totals against source records. _(Database tests: exact figures on known records, and totals checked against the source tables; see docs/REPORTS.md.)_

**Done when:** Users can generate accurate, permission-aware reports from real application data.

---

## Phase 12: Notifications and Automations

**Goal:** Keep users informed and reduce repetitive work.

- [x] Implement in-app notifications.
- [x] Notify staff about newly assigned tickets and tasks. _(Since Phases 8–9; now also urgent tickets, due and overdue tasks, maintenance.)_
- [x] Notify customers about ticket status changes. _(In the app for customers who sign in; by email for others when the automation is on.)_
- [x] Notify authorized staff about low stock.
- [x] Notify relevant users about overdue invoices. _(Managers and the issuer; customers too, by email, when switched on.)_
- [x] Add read/unread status and notification preferences. _(In-app and email per kind of notification.)_
- [x] Avoid duplicate notifications. _(Dedupe keys on notifications and automation actions.)_
- [x] Log automation outcomes and failures.
- [x] Ensure automated actions are safe to retry. _(Successes never repeat; failures retried next run; email claimed and idempotent.)_

**Done when:** Relevant events trigger the correct notifications without duplicates or unauthorized messages.

---

## Phase 13: Settings, Administration and Audit Logs

**Goal:** Administrators can manage the system and review important activity.

- [x] Create business profile settings.
- [x] Manage user accounts, roles and permissions. _(Team page since Phase 9; Settings → Roles and permissions shows what each role can do. Roles are fixed.)_
- [x] Configure notification preferences. _(Since Phase 12; linked from Settings.)_
- [x] Manage ticket and product categories.
- [x] Configure relevant business settings. _(Business profile, invoice and tax settings, categories, automations.)_
- [x] Record important actions in audit logs. _(What changed from what to what; settings, people, security events, erasures.)_
- [x] Record who performed an action and when.
- [x] Restrict audit log access to authorized roles. _(Administrators only; managers get a limited activity feed.)_
- [x] Add account deactivation and appropriate data-retention handling. _(Deactivation tells managers about open work; daily clean-up; erase a customer on request.)_

**Done when:** Administrators can manage permitted settings and review important activity.

---

## Phase 14: Quality Assurance, Security and Performance

**Goal:** Make the application reliable, accessible and ready for real users.

### Testing
- [x] Test authentication and session handling.
- [x] Test role-based permissions and RLS policies.
- [x] Test CRUD operations for core modules.
- [x] Test API validation and error responses.
- [x] Test invoice and stock calculations.
- [x] Test ticket submission and status updates.
- [x] Add Playwright end-to-end tests for critical workflows.
- [x] Test mobile, tablet and desktop layouts.
- [x] Test loading, empty, success and error states.

### Security
- [x] Review RLS policies and test unauthorized access.
- [x] Validate and sanitize user input.
- [x] Validate uploaded file types and sizes.
- [x] Keep privileged keys and provider secrets server-side.
- [x] Apply appropriate API rate limits.
- [x] Avoid exposing sensitive customer information in logs.
- [x] Review authentication, authorization and session handling.
- [x] Check dependencies for known vulnerabilities.

### Accessibility and performance
- [x] Check keyboard navigation and visible focus states.
- [x] Add accessible labels and form error messages.
- [x] Check colour contrast.
- [x] Optimize images and assets.
- [x] Reduce unnecessary database requests.
- [x] Add pagination to large data tables.
- [x] Review loading performance and supported browsers.

**Done when:** Critical user journeys pass automated and manual testing, security checks are complete, and the application works reliably on mobile and desktop.

---

## Integrations, Multi-Platform Sharing and Email Invitations

**Goal:** Connect every outside service in one place and let people share through any connected platform, not only email. An extension of Phase 9 (team), Phase 10 (communications) and Phase 12 (notifications). Details: `docs/INTEGRATIONS.md`.

### Architecture
- [x] One provider registry (`shared/integrations.ts`) used by the app, the server and the database checks; each provider declares what its API really supports (send email, direct messages, attachments, document links, public posts, receiving replies, delivery reports).
- [x] One adapter per provider on the server (`api/_lib/integrations/`): verify, send, and OAuth (authorize, exchange, refresh, revoke).
- [x] Connections (`integrations`) written only by the server after the provider verifies them; capabilities limited to what the provider confirmed.
- [x] Credentials encrypted server-side (AES-256-GCM, `INTEGRATIONS_KEY`) in a table no signed-in role can read; OAuth with single-use state and PKCE.
- [x] One outbox and history (`communication_logs`) for every channel: provider, connection, sender, recipient, related record, message type, share group, status, provider response, errors; idempotency keys.

### Settings → Integrations
- [x] Administrators connect, test, set defaults, change settings and disconnect.
- [x] Email: Resend, Gmail / Google Workspace, Outlook / Microsoft 365, plus the built-in Resend sender.
- [x] Messaging: SMS (Twilio), WhatsApp Business (Cloud API) with delivery reports and customer replies.
- [x] Social: Facebook Pages, Instagram, LinkedIn (public posts); TikTok listed as not available.
- [ ] Provider apps and approvals: Google OAuth app and `gmail.send` verification, Microsoft app, Meta App Review and WhatsApp business verification and template, LinkedIn products, Twilio sender (see Phase 15).

### Sharing
- [x] One Share dialog: platform selection (several at once), recipients on file, message editor with templates, preview per platform, attachments or private document links, send or publish, delivery status, retry.
- [x] In Customers, Leads, Sales orders, Invoices, Support tickets, Reports and Marketing (public posts).
- [x] Direct messages, documents and public posts kept apart; posts never carry customer records or private files.
- [x] Consent per channel (email, SMS opt-out, WhatsApp opt-in, marketing consent); safe retries.

### Team invitations
- [x] Add Employee sends the Supabase Auth invitation link through the business's email connection.
- [x] Pending, Sent, Failed, Accepted, Expired and Cancelled; resend, copy link, cancel; no duplicate memberships; Welcome page to set a password.

**Done when:** A business can connect its own email, messaging and social accounts in one place, share from any module to the platforms it has connected, and invite staff by email without touching Supabase. (Done in code and tests; live use waits on the provider approvals above.)

---

## Top Bar and Calendar

**Goal:** A working search and Quick Add in the top bar, the current time, and a calendar that connects to each person's Google Calendar. Details: `docs/CALENDAR.md`.

- [x] Search across customers, properties, meters, leads, orders, invoices, tickets, products, tasks and team, as the signed-in person (row security), grouped, keyboard friendly ("/" or Ctrl+K), on phones too.
- [x] Quick Add menu of the create pages each role may open; Report a Problem for clients.
- [x] South African time and date in the top bar, updating each minute.
- [x] Calendar page: month and agenda views of appointments, task due dates, maintenance and invoice due dates; create, edit and delete appointments linked to customers.
- [x] Google Calendar as a personal connection (same integrations system): each person's events shown live; Umbane appointments copied to it, kept up to date and removed with them.
- [ ] Google app: enable the Calendar API and the `calendar.events` scope, and Google's verification for use outside your Workspace.

---

## Phase 15: Launch and Handover

**Goal:** Release a stable version of Umbane CRM and document how to run and maintain it.

- [ ] Configure the production Supabase project. (Project live; still to do: turn off open sign-up, set Site URL, redirect URLs and SMTP: docs/LAUNCH.md §2.)
- [x] Apply and verify production database migrations. (All 17 confirmed live by `npm run verify:prod`, 27 Nov 2026.)
- [x] Review production RLS policies. (840 database checks; live check confirms visitors see no data and secrets tables are closed.)
- [ ] Configure production environment variables. (Server functions answer as configured; still to add: `INTEGRATIONS_KEY`, `APP_URL` and any OAuth apps: docs/LAUNCH.md §3.)
- [x] Verify frontend and backend deployment. (`npm run verify:prod`: 44 passed, 1 warning, 0 failed.)
- [ ] Enter the business's first real records (no demo or sample data): docs/LAUNCH.md §5.
- [ ] Create production administrator access securely. (Once with supabase/bootstrap.sql; everyone else by invitation: docs/LAUNCH.md §4.)
- [ ] Verify all Must-have features on the live URL. (Signed-in checklist: docs/LAUNCH.md §6.)
- [ ] Run the final smoke test. (Automated part done with verify:prod; the signed-in part is docs/LAUNCH.md §6.)
- [ ] Confirm backup and recovery arrangements. (Supabase Pro daily backups; confirm and test a restore: docs/LAUNCH.md §7.)
- [x] Complete the README with:
  - Project overview and features
  - Live application URL
  - Stitch design reference
  - Technology stack and architecture
  - Local installation and run instructions
  - Environment variable setup
  - Test and build commands
  - Demo access instructions, if safe to publish
  - Screenshots
  - Known issues and limitations
- [x] Add an architecture diagram. (docs/ARCHITECTURE.md)
- [x] Record final test results. (docs/RELEASE.md)
- [x] Document deferred features. (docs/RELEASE.md)

**Done when:** The production application is accessible, core workflows work, documentation is complete and known limitations are recorded.

---

## API Integrations

Potential integrations, subject to provider availability and project requirements:

| Integration | Purpose | Suggested stage |
|---|---|---|
| Supabase | Database, authentication and file storage | Foundation |
| Email provider (Resend, Gmail, Microsoft 365) | Invoice and ticket emails, invitations | Built (Integrations) |
| WhatsApp Business Platform | Customer communication | Built (Integrations) |
| SMS gateway (Twilio) | Customer notifications | Built (Integrations) |
| Google Maps Platform | Property location information | Property management |
| PDF generation library | Invoices and report exports | Invoicing / Reports |

Introduce integrations only when the related core workflow is working. Confirm provider pricing, API limits, account requirements and production access before committing to an integration.

---

## Development Priority Summary

| Priority | Scope |
|---|---|
| Foundation | Phase 0: setup, CI, design system and deployment |
| Core access | Phase 1: authentication, roles, database and RLS |
| MVP operations | Phases 2–4: dashboard, customers, properties and meters |
| Business operations | Phases 5–7: leads, sales, invoices and inventory |
| Customer service | Phases 8–9: tickets, staff and tasks |
| Extended capabilities | Phases 10–13: communication, reports, notifications and administration |
| Release readiness | Phases 14–15: QA, security, performance and launch |

## Dependency Order

```text
Phase 0: Foundation
    ↓
Phase 1: Authentication, Roles and Database
    ↓
Phase 2: Dashboard
    ↓
Phase 3: Customers and Properties
    ↓
Phase 4: Electricity and Meters
    ↓
Phase 5: Leads, Sales and Orders
    ↓
Phase 6: Invoices and Payments
    ↓
Phase 7: Inventory
    ↓
Phase 8: Support Tickets
    ↓
Phase 9: Team and Tasks
    ↓
Phase 10: Communication Integrations
    ↓
Phase 11: Reports and Analytics
    ↓
Phase 12: Notifications and Automations
    ↓
Phase 13: Settings and Administration
    ↓
Phase 14: QA, Security and Performance
    ↓
Phase 15: Launch and Handover
```

Some work can overlap once dependencies are ready. For example, dashboard layout and design-system work can proceed alongside database planning. Do not release a feature until its required data model, permissions and tests are in place.

---

## Project Completion Criteria

Umbane CRM's initial production release is ready when:

- Users can securely sign in and access features based on their roles.
- Database policies prevent unauthorized access to business and customer records.
- Customers and properties can be registered and managed.
- Electricity meters and readings can be recorded and reviewed.
- Customers can submit and track support tickets.
- Staff can manage assigned tickets and tasks.
- Invoices can be generated and payments tracked.
- Products and stock movements can be managed.
- Core reports are available to authorized users.
- The production application is deployed and connected to its database.
- CI, critical automated tests and production smoke tests pass.
- Setup, deployment and user documentation are available.

**Note:** This plan is a roadmap, not a claim that every listed feature is already implemented. Update the checkboxes as work is completed and adjust scope based on the actual Umbane requirements.
