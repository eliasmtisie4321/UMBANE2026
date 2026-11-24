# Umbane CRM

React + TypeScript + Vite + Tailwind CSS, with Supabase as the backend. See
[IMPLEMENTATION-v1.1.md](IMPLEMENTATION-v1.1.md) for the phased plan.

## Requirements

- Node.js 22.12+ (see `.nvmrc`)

## Local setup

```bash
npm ci
cp .env.example .env   # fill in public Supabase values only
npm run dev
```

## Scripts

| Script                            | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                     | Start the dev server                                         |
| `npm run lint`                    | ESLint                                                       |
| `npm run format` / `format:check` | Prettier                                                     |
| `npm run typecheck`               | TypeScript                                                   |
| `npm test`                        | Unit/component tests (Vitest)                                |
| `npm run test:e2e`                | Playwright end-to-end tests (`npx playwright install` first) |
| `npm run build`                   | Production build                                             |

Never commit secrets or Supabase service-role keys.

## Troubleshooting

- **Windows:** if `npm test` fails with `Cannot read properties of undefined (reading 'config')`,
  your shell's working directory uses a lowercase drive letter (`c:\...`). Run the tests from a
  shell opened at `C:\...` (uppercase). This does not affect CI.
