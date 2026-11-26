# Roles and permissions

Draft for review. Enforced in the database with Row Level Security (RLS); the frontend only mirrors it.

## Assumptions (change before applying if wrong)

1. **Multi-business ready.** Every business record has a `business_id`. A user belongs to exactly one
   business (`profiles.business_id`) and can never see another business's rows. A single-business
   deployment simply has one row in `businesses`.
2. **One role per user** (`profiles.role`): `administrator`, `manager`, `staff`, `client`.
3. **Clients** are linked to a `customers` row through `customers.profile_id` and see only their own data.
4. **Users are created by an administrator** (server-side, service-role key, never the browser). Signing
   up alone creates no profile, so a stranger who signs up sees nothing.
5. **Deactivated users** (`profiles.is_active = false`) lose all access immediately.

## Matrix

C = create, R = read, U = update, D = delete. "own" = rows linked to the user's own customer record.

| Data                         | Administrator | Manager | Staff                  | Client                      |
| ---------------------------- | ------------- | ------- | ---------------------- | --------------------------- |
| Business settings            | R U           | R       | R                      | -                           |
| Profiles / roles             | C R U D       | R       | R                      | R own                       |
| Customers, properties        | C R U D       | C R U D | C R U                  | R own                       |
| Meters, readings             | C R U D       | C R U D | C R U                  | R own                       |
| Leads, sales                 | C R U D       | C R U D | C R U                  | -                           |
| Orders, order items          | C R U D       | C R U D | C R U                  | R own                       |
| Invoices, payments           | C R U D       | C R U D | C R U                  | R own                       |
| Products, stock transactions | C R U D       | C R U D | C R U                  | -                           |
| Support tickets              | C R U D       | C R U D | C R U                  | C R own                     |
| Ticket messages              | C R U D       | C R U D | C R U (incl. internal) | C R own, **never internal** |
| Staff tasks                  | C R U D       | C R U D | R U assigned to them   | -                           |
| Notifications                | own           | own     | own                    | own                         |
| Communication logs           | C R           | C R     | C R                    | -                           |
| Audit logs                   | R             | R       | -                      | -                           |

Notes:

- Staff cannot delete. Deletion is for managers and administrators.
- A user can edit their own profile details but **cannot change their own role or business**; only an
  administrator can.
- Audit logs are written by database triggers/functions, never directly by users.
- Finalised invoices (not `draft`) are locked against edits by staff; handled in Phase 6.

## Testing

`npm run test:db` applies every migration plus `supabase/seed.sql` to an in-memory Postgres (PGlite)
and runs `supabase/tests/rls.test.sql`, acting as each role. It runs in CI on every PR. PGlite uses a
stand-in for Supabase's `auth` schema, so also run `supabase/tests/rls.test.sql` once in the SQL editor
of a **development** Supabase project after applying migrations.

## Customers and properties (Phase 3)

- Staff, managers and administrators can create and edit customers and properties. Clients can only view
  their own records and cannot open the create or edit pages.
- Customers are deactivated, not deleted, so invoices, tickets and history stay intact. Hard deletion
  remains a manager/administrator database permission with no screen yet.
- The ID number is stored in full but shown masked (`880514•••••84`) on the profile. It is personal
  information under POPIA: decide who may see it and how long it is kept before going live.
- Duplicates are refused by the database (same email, ID number, company registration number, property
  ID, or the same customer registering the same address twice) and shown as a message on the field.

## Electricity and meters (Phase 4)

- Staff and above register and edit meters, record readings, and schedule and update maintenance.
- Readings are never edited. A manager or administrator removes a wrong one and it is recorded again;
  the audit log keeps the removed value.
- Only a manager or administrator can put a retired meter back into service (no screen yet).
- Clients see their own meters, readings and consumption. Maintenance (work notes, technician names) is
  staff only.
- Links between customers, properties, meters, readings and maintenance include the business in the
  foreign key, so a record cannot point at another business's record even if its ID is known.

## Leads, sales and orders (Phase 5)

- Staff and above manage leads, orders and activities. Clients see their own orders, read-only, including
  order notes; never leads, activities, history or sales.
- Staff may delete the **lines** of a pending order, because editing an order replaces its lines. They still
  cannot delete orders.
- A sale that belongs to an order is written by the database only. This narrows the matrix above: staff can
  no longer add or change those sales directly.
- Status history is written by the database and cannot be edited or erased by anyone signed in.

## Invoices and payments (Phase 6)

- Staff create and edit draft invoices, issue them and record payments. Issued invoices are locked for
  everyone.
- Cancelling an issued invoice and removing a payment are for managers and administrators. This narrows the
  matrix above.
- Clients see their own issued invoices, their lines and payments, and can download the PDF. They never see
  drafts, including drafts that were cancelled.
- Every signed-in user can read their own business's billing details (name, VAT number, bank details), so
  clients can see where to pay. Only administrators can change them.
