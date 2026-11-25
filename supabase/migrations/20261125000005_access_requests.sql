-- Access requests: the public "Create account" button on the login page.
-- Accounts are still created by an administrator; this only records who is asking.
-- Anonymous visitors have no table access at all. They can call one function, request_access(),
-- which validates the input and inserts a pending row.

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+27[0-9]{9}$'),
  message text check (message is null or char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open request per email address: repeat submissions are quietly ignored.
create unique index access_requests_pending_email_uniq
  on public.access_requests (business_id, lower(email)) where status = 'pending';
create index access_requests_business_status_idx
  on public.access_requests (business_id, status, created_at desc);

create trigger set_updated_at before update on public.access_requests
  for each row execute function public.set_updated_at();

alter table public.access_requests enable row level security;

-- Reviewing requests is a manager/administrator job; nobody can create rows directly.
create policy access_requests_select on public.access_requests for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up());
create policy access_requests_update on public.access_requests for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager_up())
  with check (business_id = public.current_business_id() and public.is_manager_up());
create policy access_requests_delete on public.access_requests for delete to authenticated
  using (business_id = public.current_business_id() and public.is_admin());

revoke all on public.access_requests from anon;

create trigger audit_row_change after insert or update or delete on public.access_requests
  for each row execute function public.audit_row_change();

-- The only thing the public can do. Returns nothing, whether or not the address was already
-- known, so the form cannot be used to find out who has a request or an account.
-- Single-business deployment: the request goes to the (oldest) business. A multi-business
-- rollout should pass a business slug instead.
create function public.request_access(
  p_full_name text, p_email text, p_phone text default null, p_message text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  biz uuid;
begin
  select id into biz from public.businesses order by created_at limit 1;
  if biz is null then
    raise exception 'not configured';
  end if;

  insert into public.access_requests (business_id, full_name, email, phone, message)
  values (
    biz,
    btrim(p_full_name),
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_message, '')), '')
  )
  on conflict (business_id, lower(email)) where status = 'pending' do nothing;
end;
$$;

revoke execute on function public.request_access(text, text, text, text) from public;
grant execute on function public.request_access(text, text, text, text) to anon, authenticated;
