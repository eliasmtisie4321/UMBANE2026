# Environment configuration

| Variable                  | Where                                                            | Public?                                           |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `VITE_SUPABASE_URL`       | `.env` locally; Vercel project settings for preview + production | Yes                                               |
| `VITE_SUPABASE_ANON_KEY`  | same                                                             | Yes (protected by Row Level Security)             |
| Supabase service-role key | Server-side only (future Edge Functions / CI secrets)            | **Never** in the frontend, `.env.example`, or git |

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
  client-side routes work on refresh and deep links.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview in
  Vercel → Project Settings → Environment Variables. Never add the service-role key.

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
