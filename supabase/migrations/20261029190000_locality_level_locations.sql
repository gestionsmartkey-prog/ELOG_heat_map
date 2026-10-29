-- Locality-level sellers: files with no street (Mercado Libre publishes only the locality) load as
-- approximate locations. A location now says how precise it is, a seller carries filterable
-- attributes, and the map view exposes the latest value of each metric.

-- 1. How precise a location is. Existing rows are doors.
alter table public.locations
  add column if not exists precision text not null default 'street';
alter table public.locations drop constraint if exists locations_precision_check;
alter table public.locations
  add constraint locations_precision_check check (precision in ('street', 'locality', 'partido', 'ciudad'));
create index if not exists locations_precision_idx on public.locations(precision);

-- 2. Categorical attributes used as map filters (flex_candidate, reputation, power_seller, ...).
alter table public.sellers
  add column if not exists attrs jsonb not null default '{}'::jsonb;

-- 3. A less precise location never replaces a more precise one: a locality file loaded after a
--    street-level file must not move its sellers off their doors.
create or replace function public._precision_rank(p text) returns integer language sql immutable as $$
  select case p when 'street' then 3 when 'locality' then 2 when 'partido' then 1 when 'ciudad' then 1 else 0 end
$$;

create or replace function public._pick_location(p_current uuid, p_next uuid) returns uuid language sql stable as $$
  select case
    when p_next is null then p_current
    when p_current is null then p_next
    when public._precision_rank((select precision from public.locations where id = p_next))
       < public._precision_rank((select precision from public.locations where id = p_current)) then p_current
    else p_next
  end
$$;

-- 4. Map view: append the precision, the attributes and the latest value of every metric.
--    (Columns are appended: create or replace cannot reorder existing ones.)
create or replace view public.map_sellers with (security_invoker = true) as
select s.id, s.external_id, s.kind, k.label as kind_label, k.counts_as_seller, s.name, s.source,
       s.opening_hours, s.note_address, s.active,
       l.id as location_id, l.address_display, l.locality, l.partido, l.province, l.postal_code,
       l.lat, l.lng, l.h3_r9, l.geocode_status,
       s.unit, coalesce(l.address_edited, false) as address_edited,
       coalesce(l.precision, 'street') as precision,
       s.attrs,
       (select coalesce(jsonb_object_agg(m.metric, m.value), '{}'::jsonb)
          from (select distinct on (metric) metric, value
                  from public.seller_metrics where seller_id = s.id
                 order by metric, period desc nulls last) m) as metrics
from public.sellers s
join public.seller_kinds k on k.kind = s.kind
left join public.locations l on l.id = s.location_id;

revoke all on function public._precision_rank(text) from public, anon, authenticated;
revoke all on function public._pick_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public._precision_rank(text) to service_role;
grant execute on function public._pick_location(uuid, uuid) to service_role;
