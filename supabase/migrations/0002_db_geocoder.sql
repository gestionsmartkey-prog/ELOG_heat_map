-- Geocode pending locations from inside Postgres using Argentina's georef API.
-- Used when the machine running the ingest pipeline has no outbound access.
-- Requires the "http" and "unaccent" extensions (enabled in 0001).
--
-- Strategy per address: try several query variants (full street, street with
-- honorifics/ranks stripped, last two tokens, last token) and accept a hit only
-- when its locality/partido agrees with the row (CABA rows: any CABA hit).

create or replace function public._georef_variants(p_street text)
returns text[]
language plpgsql immutable
as $$
declare
  s text := regexp_replace(extensions.unaccent(p_street), '\s+', ' ', 'g');
  stripped text;
  toks text[];
  out text[] := array[]::text[];
begin
  out := out || s;
  stripped := regexp_replace(s, '^(dr\.?|doctor|doctora|dra\.?|gral\.?|general|alte\.?|almirante|cnel\.?|coronel|tte\.?|teniente|cap\.?|capitan|ing\.?|ingeniero|pte\.?|presidente|reverendo|padre|monsenor|mons\.?|cjal\.?|concejal|consejal|prof\.?|profesor|virrey|fray|san|santa|av\.?|avenida|calle|pasaje|pje\.?|diagonal|colectora|bv\.?|boulevard|boulevar)\s+', '', 'i');
  if stripped <> s then out := out || stripped; end if;
  toks := regexp_split_to_array(regexp_replace(stripped, '[^A-Za-z0-9 ]', '', 'g'), ' ');
  if array_length(toks, 1) >= 3 then out := out || array_to_string(toks[array_length(toks,1)-1:array_length(toks,1)], ' '); end if;
  if array_length(toks, 1) >= 2 and length(toks[array_length(toks,1)]) >= 5 then out := out || toks[array_length(toks,1)]; end if;
  return out;
end $$;

create or replace function public._georef_locality_matches(hit jsonb, p_locality text, p_province text)
returns boolean
language sql immutable
as $$
  select case
    when p_province = 'CABA' then hit->'provincia'->>'id' = '02'
    when p_locality is null then true
    else extensions.unaccent(lower(coalesce(hit->'localidad_censal'->>'nombre',''))) like '%' || extensions.unaccent(lower(p_locality)) || '%'
      or extensions.unaccent(lower(coalesce(hit->'departamento'->>'nombre',''))) like '%' || extensions.unaccent(lower(p_locality)) || '%'
      or extensions.unaccent(lower(coalesce(hit->>'nomenclatura',''))) like '%' || extensions.unaccent(lower(p_locality)) || '%'
      -- GBA localities whose partido has another name
      or (extensions.unaccent(lower(p_locality)) in ('castelar','haedo','villa sarmiento','el palomar') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'moron')
      or (extensions.unaccent(lower(p_locality)) in ('libertad') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'merlo')
      or (extensions.unaccent(lower(p_locality)) in ('ramos mejia','ciudadela','lomas del mirador','isidro casanova') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'la matanza')
      or (extensions.unaccent(lower(p_locality)) in ('martinez') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'san isidro')
      or (extensions.unaccent(lower(p_locality)) in ('villa ballester','villa maipu') and lower(coalesce(hit->'departamento'->>'nombre','')) like 'general san mart%')
      or (extensions.unaccent(lower(p_locality)) in ('los polvorines','villa de mayo','grand bourg','pablo nogues','tortuguitas','ingeniero adolfo sourdeaux') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'malvinas argentinas')
      or (extensions.unaccent(lower(p_locality)) in ('garin','benavidez','nordelta','don torcuato') and lower(coalesce(hit->'departamento'->>'nombre','')) in ('escobar','tigre'))
      or (extensions.unaccent(lower(p_locality)) in ('villa rosa','del viso') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'pilar')
      or (extensions.unaccent(lower(p_locality)) in ('la reja','trujui') and lower(coalesce(hit->'departamento'->>'nombre','')) = 'moreno')
  end;
$$;

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
begin
  select * into l from public.locations where id = p_location_id;
  if l is null then return 'missing'; end if;
  if l.manual_override or l.geocode_status = 'ok' then return 'skip'; end if;
  if l.street is null then
    update public.locations set geocode_status = 'failed' where id = p_location_id; return 'failed';
  end if;

  prov := case l.province when 'CABA' then '02' when 'Buenos Aires' then '06' else null end;

  foreach v in array public._georef_variants(l.street) loop
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

-- Batch runner: retries pending/failed/review rows (never manual overrides), returns a tally.
create or replace function public.georef_geocode_pending(p_limit int default 50)
returns table(status text, n bigint)
language sql
security definer
set search_path = public, extensions
as $$
  with todo as (
    select id from public.locations where geocode_status in ('pending','failed','review') and street is not null and not manual_override order by created_at limit p_limit
  ), done as (
    select public.georef_geocode_one(id) as status from todo
  )
  select status, count(*) from done group by status;
$$;

revoke all on function public.georef_geocode_one(uuid) from public, anon, authenticated;
revoke all on function public.georef_geocode_pending(int) from public, anon, authenticated;
revoke all on function public._georef_variants(text) from public, anon, authenticated;
revoke all on function public._georef_locality_matches(jsonb, text, text) from public, anon, authenticated;
