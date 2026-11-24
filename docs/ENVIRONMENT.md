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
