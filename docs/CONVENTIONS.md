# Conventions

## Structure (`src/`)

| Folder           | Contents                                                      |
| ---------------- | ------------------------------------------------------------- |
| `screens/`       | One folder per routed page (`LoginScreen`, `DashboardScreen`) |
| `components/ui/` | Shared primitives (Button, Input, Card, ...)                  |
| `components/`    | Feature components reused across screens                      |
| `layouts/`       | Page shells: sidebar, top nav, responsive navigation          |
| `hooks/`         | Reusable React hooks (`useX`)                                 |
| `services/`      | Data access (Supabase calls). Return `Result<T>`, never throw |
| `types/`         | Shared TypeScript types                                       |
| `utils/`         | Pure helpers                                                  |

## Naming

- Components and screens: `PascalCase.tsx`; hooks: `useThing.ts`; other files: `camelCase.ts`.
- Tests sit next to the code: `Thing.test.ts(x)`. Browser tests live in `e2e/`.
- Import across folders with the `@/` alias (`@/utils/result`).

## Errors and API responses

Services return `Result<T>` from `@/types/api` (`ok(data)` / `err({ code, message })`).
Convert caught exceptions with `toAppError`. UI shows `error.message`; branch on `error.code`.

## Backend

Supabase is the data layer; permissions are enforced with Row Level Security. No Express server
until a server-only need (secrets, provider webhooks) appears.
