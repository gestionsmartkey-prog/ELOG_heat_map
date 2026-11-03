-- Size bands are data. A band starts at min_value (inclusive) and runs up to the next band's
-- min_value; max_value is that next start, kept for readability (null = no ceiling). Volumes are
-- whole packages, so enterprise starting at 5001 keeps 5,000 in core.
create table if not exists public.size_bands (
  band text primary key check (band in ('micro', 'chico', 'core', 'enterprise')),
  label text not null,
  min_value numeric not null unique,
  max_value numeric,
  counts_toward_target boolean not null,
  sort smallint not null unique
);
alter table public.size_bands enable row level security;
insert into public.size_bands(band, label, min_value, max_value, counts_toward_target, sort) values
  ('micro', 'Micro', 0, 100, true, 1),
  ('chico', 'Chico', 100, 1000, true, 2),
  ('core', 'Core', 1000, 5001, true, 3),
  ('enterprise', 'Enterprise', 5001, null, false, 4)
on conflict (band) do nothing;

-- Latest monthly volume on the seller row; seller_metrics keeps the dated history.
alter table public.sellers add column if not exists shipments_month numeric;
create index if not exists sellers_shipments_month_idx on public.sellers(shipments_month);

create or replace function public._refresh_shipments_month() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  if tg_op = 'DELETE' then
    if old.metric <> 'shipments_month' then return null; end if;
    sid := old.seller_id;
  else
    if new.metric <> 'shipments_month' then return null; end if;
    sid := new.seller_id;
  end if;
  update public.sellers s
     set shipments_month = latest.value
    from (select (select m.value from public.seller_metrics m
                   where m.seller_id = sid and m.metric = 'shipments_month'
                   order by m.period desc nulls last, m.created_at desc limit 1) as value) latest
   where s.id = sid and s.shipments_month is distinct from latest.value;
  return null;
end $$;
revoke all on function public._refresh_shipments_month() from public, anon, authenticated;

drop trigger if exists seller_metrics_shipments_month on public.seller_metrics;
create trigger seller_metrics_shipments_month
  after insert or update or delete on public.seller_metrics
  for each row execute function public._refresh_shipments_month();

update public.sellers s
   set shipments_month = m.value
  from (select distinct on (seller_id) seller_id, value
          from public.seller_metrics where metric = 'shipments_month'
         order by seller_id, period desc nulls last, created_at desc) m
 where m.seller_id = s.id;
