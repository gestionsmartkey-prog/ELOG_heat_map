-- 0003: geocoder pass callable from the app.
--   georef_geocode_pending(p_limit, p_retry): p_retry=false only touches never-tried rows
--   (the upload flow); p_retry=true also retries failed/review rows (the "Reintentar" button).
--   geocode_status_counts(): one-row tally the import page polls.

drop function if exists public.georef_geocode_pending(int);

create or replace function public.georef_geocode_pending(p_limit int default 20, p_retry boolean default false)
returns table(status text, n bigint)
language sql
security definer
set search_path = public, extensions
as $$
  with todo as (
    select id from public.locations
    where street is not null and not manual_override
      and (geocode_status = 'pending' or (p_retry and geocode_status in ('failed','review')))
    order by created_at
    limit p_limit
  ), done as (
    select public.georef_geocode_one(id) as status from todo
  )
  select status, count(*) from done group by status;
$$;

create or replace function public.geocode_status_counts()
returns table(pending bigint, ok bigint, failed bigint, review bigint, manual bigint)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where geocode_status = 'pending' and street is not null and not manual_override),
    count(*) filter (where geocode_status = 'ok'),
    count(*) filter (where geocode_status = 'failed'),
    count(*) filter (where geocode_status = 'review'),
    count(*) filter (where manual_override)
  from public.locations;
$$;

revoke all on function public.georef_geocode_pending(int, boolean) from public, anon, authenticated;
revoke all on function public.geocode_status_counts() from public, anon, authenticated;
-- The app calls these through the secret key (service_role); nothing else may.
grant execute on function public.georef_geocode_pending(int, boolean) to service_role;
grant execute on function public.geocode_status_counts() to service_role;
