# Quality, security and performance

How Umbane CRM is tested, what was reviewed for security, and how fast it loads. Every pull request runs
the automated checks in CI (`.github/workflows/ci.yml`); the manual checks below are for a release.

## Automated tests

| Suite                 | Command            | What it covers                                                                                                                                                                              |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                  | `npm run lint`     | Code style and React rules                                                                                                                                                                  |
| Types                 | `npx tsc -b`       | The app, the server functions (`api/`) and the end-to-end tests                                                                                                                             |
| Unit and screen tests | `npm test`         | Services, calculations, forms, permissions, every screen's loading, empty, success and error states, the server functions, the security headers                                             |
| Database tests        | `npm run test:db`  | Every migration on an in-memory Postgres, then row security for every role, validation, invoice and stock maths, triggers, audit, retention and rate limits (`supabase/tests/rls.test.sql`) |
| End-to-end tests      | `npm run test:e2e` | The built app in Chromium with the backend stood in (`e2e/`): journeys, layouts on desktop, tablet and phone, and accessibility                                                             |
| Build                 | `npm run build`    | The production bundle                                                                                                                                                                       |

The end-to-end tests need the Playwright browser once: `npx playwright install chromium`. They build the
app into `dist-e2e/` and serve it on `127.0.0.1:4173`; no Supabase project or secrets are needed. On a
slow computer they can time out; CI is the reference run, and its report is attached to a failed run.

### What the end-to-end tests check

- **Signing in:** a visitor is sent to sign in; a wrong password is explained; signing in opens the
  dashboard; a session that ran out goes back to sign in; signing out ends the session.
- **Roles:** staff cannot open reports and are not offered them; a client sees only their own areas.
- **Everyday work:** staff add a customer; a client opens a support ticket; an invoice adds up its
  lines, VAT and total as you type.
- **Layout:** eight main pages and the sign-in page fit desktop (1440 px), tablet (768 px) and phone
  (Pixel 7) without sideways scrolling, and the menu can be reached on each.
- **Accessibility:** axe-core (WCAG 2.1 A and AA) on 13 pages at all three sizes: labels, names, colour
  contrast, landmarks and ARIA; and a visible focus ring for keyboard users.

## Manual checks before a release

Run these on the preview deployment with real (test) accounts for each role.

**Keyboard**

- [ ] Every page can be used without a mouse: Tab reaches each control in reading order, Enter and
      Space work buttons, Escape closes dialogs and menus.
- [ ] Focus is always visible, and returns to the button that opened a dialog when it closes.
- [ ] The mobile menu opens and closes from the keyboard.

**Screen reader** (NVDA with Chrome or Firefox on Windows; VoiceOver with Safari on iPhone)

- [ ] Each page announces its heading; form fields read their label and any error.
- [ ] Saving, errors and "loading" are announced.
- [ ] Tables read their column headings.

**Browsers and devices**

- [ ] Chrome, Edge, Firefox and Safari (latest two versions), on a laptop.
- [ ] Safari on an iPhone and Chrome on an Android phone: sign in, open a ticket with a photo, view an
      invoice.
- [ ] A tablet in portrait and landscape.

**Journeys with real data**

- [ ] Each role signs in and sees only its own menu items.
- [ ] Add a customer, property and meter; record a reading.
- [ ] Create, send and pay an invoice; check the totals and the PDF.
- [ ] Receive stock and sell it; check the stock level.
- [ ] A client opens a ticket with an attachment; staff reply and close it.
- [ ] Reports export to CSV and PDF.

## Supported browsers

The build targets browsers that are "widely available" (Vite's default): Chrome and Edge 111+, Firefox
114+, Safari 16.4+ (iOS 16.4+). Older browsers are not supported. Internet Explorer is not supported.

## Security review

| Area                 | What is in place                                                                                                                                                                                                                                                                                                                                     | Checked by                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Row security         | Every table has row security; each business sees only its own rows; each role is limited as in `docs/PERMISSIONS.md`. Privileged work runs in checked database functions.                                                                                                                                                                            | Database tests run every table as each role and as a signed-out visitor |
| Input                | Forms check input before sending (`src/utils/*Form.ts`); the database checks it again with constraints and triggers, so a hand-made request is refused too. Errors shown to people never include database detail.                                                                                                                                    | Unit and database tests                                                 |
| Uploads              | Attachments: at most 10 MB each; photos (JPG, PNG, WebP) and PDF on tasks, plus CSV and text on tickets, and PDF only on emails. The type is decided from the file name, and file names are cleaned before storing. Checked in the browser and again by the storage buckets. Buckets are private; files open through signed links that last an hour. | Unit tests (`src/utils/files.ts`), bucket settings in the migrations    |
| Secrets              | The service-role key, Resend key, webhook secret and cron secret are only in Vercel's server settings and only read in `api/`. The browser has only the public Supabase URL and anon key. `.env*` files are git-ignored.                                                                                                                             | `api/` tests; review of `src/` and `.env.example`                       |
| Rate limits          | Server functions: sending a message 20 a minute per person, notification email 10, delivery status 30, the Resend webhook 600 per address. "Request access": 30 an hour per business.                                                                                                                                                                | `api/` and database tests                                               |
| Logs                 | The app and server functions do not write customer details to logs. The audit log leaves out passwords, tokens and secrets, and an erased customer's details are removed from it.                                                                                                                                                                    | Database tests (`audit_redact`, erasure)                                |
| Sign-in and sessions | Supabase Auth; a session that cannot be refreshed signs the person out; signing out can end every other session; password changes ask for the current password.                                                                                                                                                                                      | Unit and end-to-end tests                                               |
| Headers              | `vercel.json`: a Content Security Policy (scripts only from the app; connections only to the app and Supabase; no frames; no plugins), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS and `Cross-Origin-Opener-Policy`.                                                                            | `src/securityConfig.test.ts`                                            |
| Dependencies         | `npm audit` reports no known vulnerabilities (November 2026). Run it again before each release.                                                                                                                                                                                                                                                      | `npm audit`                                                             |

## Performance

- **Smaller first load:** each screen is a separate download, fetched when it is first opened
  (`src/App.tsx`). React, Supabase and the icons are separate files that the browser keeps between
  releases. The first page now downloads about 22 KB of app code (gzip) plus the shared libraries,
  instead of the whole app.
- **Caching:** files under `/assets/` have content-hashed names and are cached for a year.
- **Fewer requests:** lists load one page at a time (25 rows) with the count in the same request; reports
  are computed in the database in one call; the unread count and the notification email queue are checked
  at most once per page change.
- **Images:** the app ships no large images; the icon is an SVG, and fonts load with `display=swap`.
