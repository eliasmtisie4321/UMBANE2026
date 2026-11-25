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

- [ ] Create invoices for customers and orders.
- [ ] Generate unique invoice numbers.
- [ ] Add products, services, quantities and prices.
- [ ] Calculate subtotals, applicable taxes and totals.
- [ ] Define statuses: Draft, Sent, Partially Paid, Paid, Overdue and Cancelled.
- [ ] Record payments and payment references.
- [ ] Calculate outstanding balances.
- [ ] Generate downloadable PDF invoices.
- [ ] Store invoice history.
- [ ] Send invoices through supported channels when configured.
- [ ] Prevent unauthorized editing of finalized invoices.
- [ ] Test totals, partial payments and status transitions.

**Done when:** Staff can create an invoice, record a payment and see the correct outstanding balance.

---

## Phase 7: Inventory and Product Management

**Goal:** Staff can manage products and keep stock quantities accurate.

- [ ] Register and edit products.
- [ ] Store product names, descriptions, SKU codes and prices.
- [ ] Track current stock quantities.
- [ ] Record stock received, sold, adjusted or returned.
- [ ] Maintain inventory transaction history.
- [ ] Configure low-stock thresholds and alerts.
- [ ] Connect orders and sales to inventory movements.
- [ ] Prevent invalid stock changes.
- [ ] Define whether negative stock is allowed.
- [ ] Test stock calculations and concurrent updates.

**Done when:** Product quantities update correctly when authorized stock transactions occur.

---

## Phase 8: Customer Support and Ticket Management

**Goal:** Customers can submit support requests and staff can manage them through resolution.

### Customer portal
- [ ] Create the customer support portal.
- [ ] Allow authenticated clients to submit tickets.
- [ ] Capture subject, category, description and related property where applicable.
- [ ] Generate unique ticket reference numbers.
- [ ] Allow image and document attachments.
- [ ] Validate file types and sizes.
- [ ] Allow clients to view only their own tickets.
- [ ] Display ticket status and response history.

### Staff ticket management
- [ ] Display incoming tickets.
- [ ] Assign tickets to staff.
- [ ] Add internal notes separate from customer-visible messages.
- [ ] Allow staff to respond to customers.
- [ ] Track status changes and timestamps.
- [ ] Filter by status, category, priority and assigned staff.
- [ ] Notify relevant users about updates.

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

- [ ] Create and manage staff profiles.
- [ ] Assign tasks with descriptions, priorities and deadlines.
- [ ] Track task statuses.
- [ ] Link tasks to customers, properties or tickets where relevant.
- [ ] Allow staff to add progress updates.
- [ ] Support proof-of-work image uploads where needed.
- [ ] Track completion dates and responsible staff.
- [ ] Restrict task visibility and updates according to role.

**Done when:** A manager can assign a task and track its progress through completion.

---

## Phase 10: Marketing and Communication Integrations

**Goal:** Improve communication with customers through supported channels.

- [ ] Store communication history.
- [ ] Integrate an email provider for notifications and invoices.
- [ ] Investigate and configure WhatsApp Business Platform integration.
- [ ] Select an SMS provider if SMS is required.
- [ ] Create reusable message templates.
- [ ] Record delivery status and provider responses where available.
- [ ] Handle failed messages and retries safely.
- [ ] Store API credentials securely on the server.
- [ ] Obtain required customer consent and respect communication preferences.
- [ ] Test integrations in provider sandbox/test environments before production.

**Done when:** The selected communication channel works in the deployed environment, with failures handled and logged.

---

## Phase 11: Reports and Analytics

**Goal:** Authorized users can review business performance and export reports.

- [ ] Create customer and property reports.
- [ ] Create meter and electricity consumption reports.
- [ ] Create sales and order reports.
- [ ] Create invoice and payment reports.
- [ ] Create inventory reports.
- [ ] Create support ticket reports.
- [ ] Add date-range and category filters.
- [ ] Add charts where useful.
- [ ] Support CSV or PDF exports where appropriate.
- [ ] Ensure reports respect permissions and business scope.
- [ ] Verify report totals against source records.

**Done when:** Users can generate accurate, permission-aware reports from real application data.

---

## Phase 12: Notifications and Automations

**Goal:** Keep users informed and reduce repetitive work.

- [ ] Implement in-app notifications.
- [ ] Notify staff about newly assigned tickets and tasks.
- [ ] Notify customers about ticket status changes.
- [ ] Notify authorized staff about low stock.
- [ ] Notify relevant users about overdue invoices.
- [ ] Add read/unread status and notification preferences.
- [ ] Avoid duplicate notifications.
- [ ] Log automation outcomes and failures.
- [ ] Ensure automated actions are safe to retry.

**Done when:** Relevant events trigger the correct notifications without duplicates or unauthorized messages.

---

## Phase 13: Settings, Administration and Audit Logs

**Goal:** Administrators can manage the system and review important activity.

- [ ] Create business profile settings.
- [ ] Manage user accounts, roles and permissions.
- [ ] Configure notification preferences.
- [ ] Manage ticket and product categories.
- [ ] Configure relevant business settings.
- [ ] Record important actions in audit logs.
- [ ] Record who performed an action and when.
- [ ] Restrict audit log access to authorized roles.
- [ ] Add account deactivation and appropriate data-retention handling.

**Done when:** Administrators can manage permitted settings and review important activity.

---

## Phase 14: Quality Assurance, Security and Performance

**Goal:** Make the application reliable, accessible and ready for real users.

### Testing
- [ ] Test authentication and session handling.
- [ ] Test role-based permissions and RLS policies.
- [ ] Test CRUD operations for core modules.
- [ ] Test API validation and error responses.
- [ ] Test invoice and stock calculations.
- [ ] Test ticket submission and status updates.
- [ ] Add Playwright end-to-end tests for critical workflows.
- [ ] Test mobile, tablet and desktop layouts.
- [ ] Test loading, empty, success and error states.

### Security
- [ ] Review RLS policies and test unauthorized access.
- [ ] Validate and sanitize user input.
- [ ] Validate uploaded file types and sizes.
- [ ] Keep privileged keys and provider secrets server-side.
- [ ] Apply appropriate API rate limits.
- [ ] Avoid exposing sensitive customer information in logs.
- [ ] Review authentication, authorization and session handling.
- [ ] Check dependencies for known vulnerabilities.

### Accessibility and performance
- [ ] Check keyboard navigation and visible focus states.
- [ ] Add accessible labels and form error messages.
- [ ] Check colour contrast.
- [ ] Optimize images and assets.
- [ ] Reduce unnecessary database requests.
- [ ] Add pagination to large data tables.
- [ ] Review loading performance and supported browsers.

**Done when:** Critical user journeys pass automated and manual testing, security checks are complete, and the application works reliably on mobile and desktop.

---

## Phase 15: Launch and Handover

**Goal:** Release a stable version of Umbane CRM and document how to run and maintain it.

- [ ] Configure the production Supabase project.
- [ ] Apply and verify production database migrations.
- [ ] Review production RLS policies.
- [ ] Configure production environment variables.
- [ ] Verify frontend and backend deployment.
- [ ] Load approved pilot or realistic demo data.
- [ ] Create production administrator access securely.
- [ ] Verify all Must-have features on the live URL.
- [ ] Run the final smoke test.
- [ ] Confirm backup and recovery arrangements.
- [ ] Complete the README with:
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
- [ ] Add an architecture diagram.
- [ ] Record final test results.
- [ ] Document deferred features.

**Done when:** The production application is accessible, core workflows work, documentation is complete and known limitations are recorded.

---

## API Integrations

Potential integrations, subject to provider availability and project requirements:

| Integration | Purpose | Suggested stage |
|---|---|---|
| Supabase | Database, authentication and file storage | Foundation |
| Email provider | Invoice and ticket emails | Communication |
| WhatsApp Business Platform | Customer communication | Communication |
| SMS gateway | Customer notifications | Communication |
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
