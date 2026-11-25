-- One-time setup for a new (empty) project. Run in the Supabase SQL editor.
-- Safe to re-run: it does nothing if a business already exists / the profile already exists.
--
-- Step 1: Authentication -> Users -> "Add user" -> create yourself (email + password, tick
--         "Auto Confirm User"). Then put that same email below and run this whole script.

do $$
declare
  admin_email text := 'CHANGE-ME@example.com';   -- <- the email you just created
  admin_name  text := 'CHANGE ME';               -- <- your full name
  biz uuid;
  uid uuid;
begin
  select id into biz from public.businesses order by created_at limit 1;
  if biz is null then
    insert into public.businesses (name) values ('Umbane') returning id into biz;
  end if;

  select id into uid from auth.users where lower(email) = lower(admin_email);
  if uid is null then
    raise exception 'No auth user with email %. Create it first under Authentication -> Users.', admin_email;
  end if;

  insert into public.profiles (id, business_id, role, full_name, email, is_active)
  values (uid, biz, 'administrator', admin_name, lower(admin_email), true)
  on conflict (id) do nothing;
end $$;
