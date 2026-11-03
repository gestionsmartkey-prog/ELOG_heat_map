-- sales: sees the map, exports with phone numbers and (phase 3) changes seller status.
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('viewer', 'sales', 'admin'));

-- create_app_user: same as 0005, with sales accepted.
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
  if v_role not in ('viewer', 'sales', 'admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  insert into public.app_users(email, password_hash, role, created_by)
  values (v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), v_role, p_created_by)
  on conflict (email) do update
    set password_hash = excluded.password_hash, role = excluded.role, active = true, updated_at = now();

  return query select u.email, u.role, u.active, u.created_at from public.app_users u where u.email = v_email;
end $$;
revoke all on function public.create_app_user(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_app_user(text, text, text, text) to service_role;

-- Every export is logged: who, what, how many rows, whether phones went out.
create table if not exists public.export_log (
  id bigint generated always as identity primary key,
  actor text not null,
  role text not null,
  scope text not null check (scope in ('cluster', 'hub')),
  hub_id uuid,          -- references hubs(id) once phase 3 adds the table
  label text,
  row_count integer not null,
  with_phone boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists export_log_created_idx on public.export_log(created_at desc);
alter table public.export_log enable row level security;
