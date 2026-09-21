-- 0004: bound the time one geocode takes so app-driven passes fit PostgREST's statement timeout.
-- Same logic as 0002, plus a per-call HTTP timeout and a per-location time budget.

create or replace function public.georef_geocode_one(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  l record;
  q text;
  url text;
  resp extensions.http_response;
  body jsonb;
  hit jsonb;
  v text;
  prov text;
  conf numeric;
  idx int := 0;
  t0 timestamptz := clock_timestamp();
begin
  -- PostgREST sessions run under an 8 s statement timeout. Keep one location well inside it:
  -- each georef call gets 2.5 s and no new variant starts after 4.5 s.
  perform set_config('http.timeout_msec', '2500', true);
  select * into l from public.locations where id = p_location_id;
  if l is null then return 'missing'; end if;
  if l.manual_override or l.geocode_status = 'ok' then return 'skip'; end if;
  if l.street is null then
    update public.locations set geocode_status = 'failed' where id = p_location_id; return 'failed';
  end if;

  prov := case l.province when 'CABA' then '02' when 'Buenos Aires' then '06' else null end;

  foreach v in array public._georef_variants(l.street) loop
    exit when clock_timestamp() - t0 > interval '4.5 seconds';
    idx := idx + 1;
    q := v || case when l.street_number is not null and l.street_number <> 'S/N' then ' ' || l.street_number else '' end;
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
      and public._georef_locality_matches(d, l.locality, l.province)
    limit 1;
    if hit is not null then
      conf := case idx when 1 then 0.9 when 2 then 0.8 else 0.6 end;
      update public.locations set
        lat = (hit->'ubicacion'->>'lat')::double precision,
        lng = (hit->'ubicacion'->>'lon')::double precision,
        geocode_provider = 'georef',
        geocode_confidence = conf,
        geocode_raw = hit,
        partido = coalesce(partido, hit->'departamento'->>'nombre'),
        geocode_status = case
          when (hit->'ubicacion'->>'lat')::double precision between -35.2 and -34.2
           and (hit->'ubicacion'->>'lon')::double precision between -59.2 and -57.9 then 'ok'
          else 'review' end
      where id = p_location_id;
      insert into public.geocode_cache(address_key, provider, lat, lng, confidence, raw)
      values (l.address_key, 'georef', (hit->'ubicacion'->>'lat')::double precision, (hit->'ubicacion'->>'lon')::double precision, conf, hit)
      on conflict (address_key) do update set lat = excluded.lat, lng = excluded.lng, confidence = excluded.confidence, raw = excluded.raw;
      return 'ok';
    end if;
  end loop;

  update public.locations set geocode_status = 'failed', lat = null, lng = null, geocode_raw = null where id = p_location_id;
  insert into public.review_items(location_id, reason, payload)
  select p_location_id, 'geocode_failed', jsonb_build_object('address', l.address_display, 'locality', l.locality, 'postal', l.postal_code)
  where not exists (select 1 from public.review_items r where r.location_id = p_location_id and r.reason = 'geocode_failed' and not r.resolved);
  return 'failed';
end $$;
