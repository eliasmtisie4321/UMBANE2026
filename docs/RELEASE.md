# Umbane CRM 1.0: release notes

Released November 2026. Live at https://umbane2026.vercel.app.

## What is in it

Built phase by phase (IMPLEMENTATION-v1.1.md, pull requests #2 to #52):

| Phase | Area                                                         | Pull requests                      |
| ----- | ------------------------------------------------------------ | ---------------------------------- |
| 0     | Project setup, structure, CI, Supabase config, design system | #2, #4, #6, #8, #10, #12, #14, #16 |
| 1     | Database schema and row security; sign-in and route guards   | #17, #19                           |
| 2     | Dashboard                                                    | #22                                |
| 3     | Customers, properties and account requests                   | #24, #25, #27                      |
| 4     | Electricity and meters                                       | #29                                |
| 5     | Leads, sales and orders                                      | #31                                |
| 6     | Invoices and payments                                        | #33                                |
| 7     | Inventory and products                                       | #35                                |
| 8     | Support tickets                                              | #37                                |
| 9     | Team and tasks                                               | #39                                |
| 10    | Communications (email)                                       | #41                                |
| 11    | Reports and analytics                                        | #43                                |
| 12    | Notifications and automations                                | #45                                |
| 13    | Settings, administration and audit                           | #47                                |
| 14    | Quality, security and performance                            | #49                                |
| –     | Integrations, multi-platform sharing, email invitations      | #52                                |
| 15    | Launch and handover (this release)                           | –                                  |

## Final test results

Run on 27 November 2026 at the commit of this release.

| Suite                                                                      | Result                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Lint (ESLint)                                                              | No problems                                                            |
| Types (`tsc -b`: app, server, end-to-end)                                  | No errors                                                              |
| Unit, screen and server tests (Vitest)                                     | 952 passed                                                             |
| Database: every migration, row security and rules (`npm run test:db`)      | 840 checks passed                                                      |
| End-to-end (Playwright, CI): journeys, layouts at 3 sizes, axe WCAG 2.1 AA | 88 passed                                                              |
| Production build                                                           | Built; first load about 22 KB of app code (gzip) plus shared libraries |
| Dependencies (`npm audit`)                                                 | 0 known vulnerabilities                                                |
| Live system (`npm run verify:prod`)                                        | 44 passed, 1 warning, 0 failed                                         |

The live check confirmed: the site, deep links and security headers; no server key in the browser
code; every server function refusing anonymous calls; all 17 migrations applied; anonymous visitors
seeing no data. The warning: open sign-up is on in Supabase (turn it off: `docs/LAUNCH.md`).

## Still to do by hand

These need someone signed in to the provider or the business, so they are not in the automated
results:

- Turn off open sign-up and set the Site URL, redirect URLs and custom SMTP in Supabase
  (`docs/LAUNCH.md`, section 2).
- Set `INTEGRATIONS_KEY` and `APP_URL` in Vercel, then connect the business's email account
  (Settings → Integrations) and send a test email.
- Confirm Supabase Pro backups are running, and do one test restore into a separate project.
- Run the signed-in smoke test (`docs/LAUNCH.md`, section 6) and the manual checks in `docs/QA.md`
  (keyboard, screen reader, browsers and phones).
- Enter the business's first real records (`docs/LAUNCH.md`, section 5).

## Known issues and limitations

- **Provider approvals.** Gmail / Google Workspace, Outlook / Microsoft 365, Facebook, Instagram,
  LinkedIn, WhatsApp and Twilio each need the provider's account and, for most, their approval
  before they can be connected. Until then Umbane shows them as not connected.
- **WhatsApp 24-hour rule.** Free text and documents only go within 24 hours of the customer's last
  message; otherwise an approved template is needed.
- **Outlook attachments** are limited to 3 MB each by Microsoft's API.
- **Instagram** posts need an image at a public https address.
- **Retries** run when someone sends, while someone is signed in, and once a day (Vercel's free
  plan's cron limit). On a paid plan, run them every 15 minutes.
- **Supabase link lifetime.** Invitation and password-reset links work for at most 24 hours;
  Resend gives a fresh invitation link.
- **Storage files** are not part of Supabase's database backups.
- **Report period** is limited to five years at a time.

## Deferred (not in 1.0)

| Feature                                          | Why not yet                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| TikTok posting                                   | TikTok's API only takes video and photo posts from audited apps                                               |
| Direct messages on Facebook, Instagram, LinkedIn | Their APIs only reach people who messaged the page first                                                      |
| LinkedIn company-page posts                      | Needs LinkedIn's Community Management API approval                                                            |
| Email campaigns to customer lists                | Single and multi-platform sharing is built; bulk campaigns need unsubscribe handling and sending limits first |
| Google Maps for property locations               | Listed in the plan's integrations; not needed for launch                                                      |
| Online payments (card, EFT links) on invoices    | Payments are recorded by staff; a payment provider can be added later                                         |
| Smart-meter readings imported automatically      | Readings are entered or uploaded by staff; meter-vendor APIs differ                                           |
| Offline use in the field                         | The app needs a connection                                                                                    |
| More languages (Afrikaans, isiZulu, ...)         | The app is in English                                                                                         |

## Upgrading an existing installation

Apply any migrations not yet run, in filename order (`verify:prod` lists them), set any new Vercel
settings named in `docs/ENVIRONMENT.md`, redeploy, and run `npm run verify:prod`.
