-- Provenance: every source a seller came from. One row per (seller, source); batch_id is the
-- latest file of that source. Written by a trigger on sellers, so both loaders record it for free.
-- sellers.source keeps meaning "latest source"; this table is the history the ML-id merge lost.

create table if not exists public.seller_sources (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  source text not null,
  batch_id uuid references public.import_batches(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (seller_id, source)
);
create index if not exists seller_sources_source_idx on public.seller_sources(source);
alter table public.seller_sources enable row level security;

create or replace function public._record_seller_source() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.last_seen_batch_id is null then return null; end if;
  insert into public.seller_sources(seller_id, source, batch_id)
  select new.id, b.source, b.id from public.import_batches b where b.id = new.last_seen_batch_id
  on conflict (seller_id, source) do update
    set batch_id = excluded.batch_id, last_seen_at = now();
  return null;
end $$;
revoke all on function public._record_seller_source() from public, anon, authenticated;

drop trigger if exists sellers_record_source on public.sellers;
create trigger sellers_record_source
  after insert or update of last_seen_batch_id on public.sellers
  for each row execute function public._record_seller_source();

-- Backfill from what survived the merge: the first and the last batch of each seller.
insert into public.seller_sources(seller_id, source, batch_id, first_seen_at, last_seen_at)
select s.id, b.source,
       (array_agg(b.id order by b.created_at desc))[1],
       min(b.created_at), max(b.created_at)
from public.sellers s
join public.import_batches b on b.id in (s.first_batch_id, s.last_seen_batch_id)
group by s.id, b.source
on conflict (seller_id, source) do nothing;
