-- Phase 14: rate limits.
--
-- The server functions in api/ ask rate_limit_hit() before doing work: each key (for example
-- "send:<user id>") may be used a set number of times per window. The public "Create account"
-- form is limited in the database itself, so a flood of requests cannot bury real ones.
-- Supabase Auth already limits sign-in, sign-up and password-reset attempts.
--
-- Run after 0015.

create table public.api_rate_limits (
  key text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (key, window_start)
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;

-- Counts one use of p_key in the current window and says whether it is still within p_limit.
-- Old windows for the same key are removed as it goes, so the table stays small.
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_key is null or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_limit_invalid' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into api_rate_limits (key, window_start, hits) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = api_rate_limits.hits + 1
  returning hits into v_hits;
  delete from api_rate_limits where key = left(p_key, 200) and window_start < v_window - interval '1 day';
  return v_hits <= p_limit;
end;
$$;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- The public form: at most 30 account requests an hour reach a business. Beyond that the
-- visitor is told to try again later; nothing is stored.
create or replace function public.request_access(
  p_full_name text, p_email text, p_phone text default null, p_message text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  biz uuid;
begin
  select id into biz from public.businesses order by created_at, id limit 1;
  if biz is null then
    raise exception 'not configured';
  end if;
  if not rate_limit_hit('request_access:' || biz, 30, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
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
