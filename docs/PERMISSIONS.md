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
