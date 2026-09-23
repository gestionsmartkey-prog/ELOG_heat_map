-- 0006: correct addresses from the web and keep those corrections across future imports;
-- keep different sellers at the same door apart (unit / floor).

-- 1. Alternate spellings of a door. When an address is corrected, the spelling that came in
--    the file is kept here, so the next file that still carries it resolves to the corrected door.
create table if not exists public.location_aliases (
  address_key text primary key,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists location_aliases_location_idx on public.location_aliases(location_id);
alter table public.location_aliases enable row level security;

-- A key that is an alias never becomes a door of its own, whichever loader inserts it.
create or replace function public._skip_aliased_location() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.location_aliases a where a.address_key = new.address_key) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists locations_skip_alias on public.locations;
create trigger locations_skip_alias before insert on public.locations
  for each row execute function public._skip_aliased_location();

-- 2. Who corrected a door and what the file originally said.
alter table public.locations
  add column if not exists address_edited boolean not null default false,
  add column if not exists source_address jsonb,
  add column if not exists edited_by text,
  add column if not exists edited_at timestamptz;

-- 3. Sellers: the unit inside a shared door (piso, depto, PB, oficina), and a door assigned by
--    hand that imports must not move.
alter table public.sellers
  add column if not exists unit text,
  add column if not exists location_locked boolean not null default false;

-- 4. How and by whom each review was closed.
alter table public.review_items
  add column if not exists resolution text,
  add column if not exists resolved_by text;

-- Map view: expose the unit and whether the door was corrected by hand (columns appended).
create or replace view public.map_sellers with (security_invoker = true) as
select s.id, s.external_id, s.kind, k.label as kind_label, k.counts_as_seller, s.name, s.source,
       s.opening_hours, s.note_address, s.active,
       l.id as location_id, l.address_display, l.locality, l.partido, l.province, l.postal_code,
       l.lat, l.lng, l.h3_r9, l.geocode_status,
       s.unit, coalesce(l.address_edited, false) as address_edited
from public.sellers s
join public.seller_kinds k on k.kind = s.kind
left join public.locations l on l.id = s.location_id;

-- Door id for a normalized key: the door itself, or the door it is an alias of.
create or replace function public._location_for_key(p_address_key text) returns uuid
language sql stable
set search_path = public
as $$
  select coalesce(
    (select id from public.locations where address_key = p_address_key),
    (select location_id from public.location_aliases where address_key = p_address_key)
  );
$$;

-- 5. Look an address up in Georef without writing anything (the "Buscar" button).
--    Same variants, locality check and time budget as georef_geocode_one.
create or replace function public.georef_lookup(p_street text, p_number text, p_locality text, p_province text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  q text;
  url text;
  resp extensions.http_response;
  body jsonb;
  hit jsonb;
  v text;
  prov text;
  idx int := 0;
  t0 timestamptz := clock_timestamp();
begin
  perform set_config('http.timeout_msec', '2500', true);
  if coalesce(btrim(p_street), '') = '' then return null; end if;
  prov := case p_province when 'CABA' then '02' when 'Buenos Aires' then '06' else null end;

  foreach v in array public._georef_variants(p_street) loop
    exit when clock_timestamp() - t0 > interval '4.5 seconds';
    idx := idx + 1;
    q := v || case when p_number is not null and p_number <> 'S/N' then ' ' || p_number else '' end;
    url := 'https://apis.datos.gob.ar/georef/api/direcciones?max=10&direccion=' || extensions.urlencode(q)
        || case when prov is not null then '&provincia=' || prov else '' end;
    begin
      resp := extensions.http_get(url);
    exception when others then
      resp := null;
    end;
    if resp is null or resp.status <> 200 then continue; end if;
    body := resp.content::jsonb;
    select d into hit
    from jsonb_array_elements(coalesce(body->'direcciones', '[]'::jsonb)) d
    where d->'ubicacion'->>'lat' is not null and d->'ubicacion'->>'lon' is not null
      and public._georef_locality_matches(d, p_locality, p_province)
    limit 1;
    if hit is not null then
      return jsonb_build_object(
        'lat', (hit->'ubicacion'->>'lat')::double precision,
        'lng', (hit->'ubicacion'->>'lon')::double precision,
        'confidence', case idx when 1 then 0.9 when 2 then 0.8 else 0.6 end,
        'partido', hit->'departamento'->>'nombre',
        'match', hit->>'nomenclatura'
      );
    end if;
  end loop;
  return null;
end $$;

-- 6. Correct a door's address (affects every seller at that door). The file's spelling becomes
--    an alias. If the corrected address is a door we already have, the two are merged.
create or replace function public.correct_location(
  p_location_id uuid, p_address_key text, p_street text, p_number text, p_display text,
  p_locality text, p_partido text, p_province text, p_postal text,
  p_lat double precision, p_lng double precision, p_h3 text, p_provider text,
  p_by text, p_review_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.locations;
  target uuid;
begin
  select * into cur from public.locations where id = p_location_id for update;
  if not found then raise exception 'location % not found', p_location_id using errcode = 'P0002'; end if;
  target := public._location_for_key(p_address_key);

  if target is not null and target <> cur.id then
    -- The corrected text is another door we already have: fold this one into it.
    update public.sellers set location_id = target where location_id = cur.id;
    update public.review_items set location_id = target where location_id = cur.id;
    update public.location_aliases set location_id = target where location_id = cur.id;
    delete from public.locations where id = cur.id;
    insert into public.location_aliases(address_key, location_id, created_by) values (cur.address_key, target, p_by)
      on conflict (address_key) do update set location_id = excluded.location_id;
    update public.locations set
      lat = p_lat, lng = p_lng, h3_r9 = p_h3, geocode_status = 'ok', manual_override = true,
      geocode_provider = p_provider, geocode_confidence = case when p_provider = 'manual' then 1 else geocode_confidence end,
      address_edited = true, edited_by = p_by, edited_at = now()
    where id = target;
  else
    target := cur.id;
    if cur.address_key <> p_address_key then
      -- Going back to a spelling that was an alias of this same door: it is the key again.
      delete from public.location_aliases where address_key = p_address_key;
      insert into public.location_aliases(address_key, location_id, created_by) values (cur.address_key, cur.id, p_by)
        on conflict (address_key) do update set location_id = excluded.location_id;
    end if;
    update public.locations set
      address_key = p_address_key, street = p_street, street_number = p_number, address_display = p_display,
      locality = p_locality, partido = coalesce(p_partido, partido), province = p_province, postal_code = p_postal,
      lat = p_lat, lng = p_lng, h3_r9 = p_h3, geocode_status = 'ok', manual_override = true,
      geocode_provider = p_provider, geocode_confidence = case when p_provider = 'manual' then 1 else 0.9 end, geocode_raw = null,
      address_edited = true, edited_by = p_by, edited_at = now(),
      source_address = coalesce(source_address, jsonb_build_object(
        'address_key', cur.address_key, 'street', cur.street, 'street_number', cur.street_number,
        'address_display', cur.address_display, 'locality', cur.locality, 'province', cur.province, 'postal_code', cur.postal_code))
    where id = target;
  end if;

  update public.review_items set resolved = true, resolved_at = now(), resolution = 'corrected', resolved_by = p_by
  where not resolved and (id = p_review_id or (location_id = target and reason in ('geocode_failed', 'outside_region')));
  return target;
end $$;

-- 7. Move one seller to another address (e.g. the one in their note) without touching the rest
--    of the door. The seller is locked there so the next import does not move them back.
create or replace function public.move_seller(
  p_seller_id uuid, p_address_key text, p_street text, p_number text, p_display text,
  p_locality text, p_partido text, p_province text, p_postal text,
  p_lat double precision, p_lng double precision, p_h3 text, p_provider text,
  p_by text, p_review_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  old_loc uuid;
  target uuid;
begin
  select location_id into old_loc from public.sellers where id = p_seller_id for update;
  if not found then raise exception 'seller % not found', p_seller_id using errcode = 'P0002'; end if;
  target := public._location_for_key(p_address_key);

  if target is null then
    insert into public.locations(address_key, street, street_number, address_display, locality, partido, province, postal_code,
      lat, lng, h3_r9, geocode_provider, geocode_confidence, geocode_status, manual_override, address_edited, edited_by, edited_at)
    values (p_address_key, p_street, p_number, p_display, p_locality, p_partido, p_province, p_postal,
      p_lat, p_lng, p_h3, p_provider, case when p_provider = 'manual' then 1 else 0.9 end, 'ok', true, true, p_by, now())
    returning id into target;
  else
    -- An existing door keeps a good position; it only takes the confirmed pin if it had none.
    update public.locations set
      lat = p_lat, lng = p_lng, h3_r9 = p_h3, geocode_status = 'ok', manual_override = true,
      geocode_provider = p_provider, edited_by = p_by, edited_at = now()
    where id = target and geocode_status <> 'ok';
  end if;

  update public.sellers set location_id = target, location_locked = true, note_address = null where id = p_seller_id;
  update public.review_items set resolved = true, resolved_at = now(), resolution = 'moved', resolved_by = p_by
  where not resolved and (id = p_review_id or (seller_id = p_seller_id and reason = 'address_conflict'));

  -- The old door may be empty now; its own pending reviews no longer matter.
  if old_loc is not null and old_loc <> target and not exists (select 1 from public.sellers where location_id = old_loc) then
    update public.review_items set resolved = true, resolved_at = now(), resolution = 'orphaned', resolved_by = p_by
    where not resolved and location_id = old_loc;
  end if;
  return target;
end $$;

revoke all on function public._location_for_key(text) from public, anon, authenticated;
revoke all on function public.georef_lookup(text, text, text, text) from public, anon, authenticated;
revoke all on function public.correct_location(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.move_seller(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text, text, text, bigint) from public, anon, authenticated;
-- The app calls these through the secret key (service_role); nothing else may.
grant execute on function public._location_for_key(text) to service_role;
grant execute on function public.georef_lookup(text, text, text, text) to service_role;
grant execute on function public.correct_location(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text, text, text, bigint) to service_role;
grant execute on function public.move_seller(uuid, text, text, text, text, text, text, text, text, double precision, double precision, text, text, text, bigint) to service_role;
grant select, insert, update, delete on public.location_aliases to service_role;
