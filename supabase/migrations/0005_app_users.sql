-- 0005: database-backed team members so users can be whitelisted without a redeploy.
-- Passwords are bcrypt-hashed by pgcrypto; the app reaches these only through the
-- secret key (service_role). Env APP_USERS/APP_ADMINS stay as bootstrap + fallback.

create table if not exists public.app_users (
  email text primary key,
  password_hash text not null,
  role text not null default 'viewer' check (role in ('viewer','admin')),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_users enable row level security;  -- no policies: only service_role / definer functions touch it

drop trigger if exists app_users_updated_at on public.app_users;
create trigger app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();

-- Whitelist (create or update) a user. Email is normalised; password is hashed here so plaintext never rests.
create or replace function public.create_app_user(p_email text, p_password text, p_role text default 'viewer', p_created_by text default null)
returns table(email text, role text, active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(nullif(trim(p_role), ''), 'viewer');
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'weak_password' using errcode = '22023';
  end if;
  if v_role not in ('viewer','admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  insert into public.app_users(email, password_hash, role, created_by)
  values (v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), v_role, p_created_by)
  on conflict (email) do update
    set password_hash = excluded.password_hash, role = excluded.role, active = true, updated_at = now();

  return query select u.email, u.role, u.active, u.created_at from public.app_users u where u.email = v_email;
end $$;

-- Verify a login. Returns the row only when active and the password matches.
create or replace function public.verify_app_user(p_email text, p_password text)
returns table(email text, role text)
language sql
security definer
set search_path = public, extensions
as $$
  select u.email, u.role
  from public.app_users u
  where u.email = lower(trim(p_email))
    and u.active
    and u.password_hash = extensions.crypt(p_password, u.password_hash);
$$;

create or replace function public.list_app_users()
returns table(email text, role text, active boolean, created_by text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select email, role, active, created_by, created_at from public.app_users order by created_at desc;
$$;

create or replace function public.set_app_user_active(p_email text, p_active boolean)
returns table(email text, active boolean)
language sql
security definer
set search_path = public
as $$
  update public.app_users set active = p_active, updated_at = now()
  where email = lower(trim(p_email))
  returning email, active;
$$;

revoke all on function public.create_app_user(text, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_app_user(text, text) from public, anon, authenticated;
revoke all on function public.list_app_users() from public, anon, authenticated;
revoke all on function public.set_app_user_active(text, boolean) from public, anon, authenticated;
grant execute on function public.create_app_user(text, text, text, text) to service_role;
grant execute on function public.verify_app_user(text, text) to service_role;
grant execute on function public.list_app_users() to service_role;
grant execute on function public.set_app_user_active(text, boolean) to service_role;
