import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../supabase', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })

// Minimal stand-in for the Supabase platform pieces our SQL depends on.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema extensions;
  create extension if not exists pgcrypto schema extensions;
  create schema auth;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz,
    confirmation_token text, recovery_token text, email_change text, email_change_token_new text
  );
  create table auth.identities (
    id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text,
    created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
  $$;
  -- Supabase Storage keeps file records here; the storage API enforces the bucket limits.
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text, owner uuid, owner_id text, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  grant usage on schema public, auth, extensions to anon, authenticated;
  -- Supabase grants table access to these roles by default; RLS is what restricts it.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`)

const files = [
  ...readdirSync(`${repo}/migrations`)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => `migrations/${f}`),
  'seed.sql',
]
for (const f of files) {
  try {
    await db.exec(readFileSync(`${repo}/${f}`, 'utf8'))
    console.log('applied', f)
  } catch (e) {
    console.log('FAILED', f, '\n ', e.message)
    process.exit(1)
  }
}

const notices = []
db.onNotification?.((m) => notices.push(m))
try {
  await db.exec(readFileSync(`${repo}/tests/rls.test.sql`, 'utf8'), {
    onNotice: (n) => console.log(n.message),
  })
  console.log('ALL RLS TESTS PASSED')
} catch (e) {
  console.log('TEST FAILURE:', e.message)
  process.exit(2)
}
