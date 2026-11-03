-- Slim map payload: typed columns instead of attrs/extra and the per-row metrics subquery.
-- map_sellers stays for one release so a deploy that lands before this migration still works.
create or replace view public.v_map_sellers with (security_invoker = true) as
select s.id, s.external_id, s.kind, s.name, s.source, s.unit,
       s.opening_hours, s.note_address,
       l.address_display, l.locality, l.partido, l.province, l.postal_code,
       l.lat, l.lng, l.h3_r8, l.h3_r9,
       coalesce(l.precision, 'street') as precision,
       coalesce(l.address_edited, false) as address_edited,
       s.shipments_month, s.flex_candidate,
       s.attrs->>'reputation' as reputation,
       s.attrs->>'power_seller' as power_seller,
       s.profile_url
from public.sellers s
left join public.locations l on l.id = s.location_id
where s.active;

-- One flat row per seller for the sales export (and later the CRM). Holds the phone: only the
-- export route reads it, and it drops the column for roles that may not see it.
create or replace view public.v_export_sellers with (security_invoker = true) as
select s.id, s.external_id, s.name, s.profile_url, s.phone,
       case when coalesce(l.precision, 'street') = 'street' then l.address_display
            else coalesce(l.locality, l.partido, l.address_display) end as address,
       coalesce(l.precision, 'street') <> 'street' as approximate,
       l.locality, l.partido, l.province,
       s.shipments_month,
       (select b.band from public.size_bands b
         where s.shipments_month is not null and b.min_value <= s.shipments_month
         order by b.min_value desc limit 1) as band,
       s.flex_candidate,
       s.attrs->>'reputation' as reputation,
       s.attrs->>'power_seller' as power_seller,
       (select array_agg(x.source order by x.first_seen_at) from public.seller_sources x
         where x.seller_id = s.id) as sources
from public.sellers s
left join public.locations l on l.id = s.location_id
where s.active;
