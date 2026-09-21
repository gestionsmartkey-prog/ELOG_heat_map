-- Extensions
create extension if not exists pgcrypto with schema extensions;
create extension if not exists http with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Provenance: one row per imported file
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_hash text,
  source text not null default 'meli',
  uploaded_by text,
  status text not null default 'pending', -- pending | loading | loaded | failed
  row_count integer not null default 0,
  loaded_count integer not null default 0,
  review_count integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Raw: every source row exactly as it came, immune to column changes
create table if not exists public.raw_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  row_hash text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);
create index if not exists raw_rows_batch_idx on public.raw_rows(batch_id);
create index if not exists raw_rows_hash_idx on public.raw_rows(row_hash);

-- Lookup: entity kinds are data, not an enum
create table if not exists public.seller_kinds (
  kind text primary key,
  label text not null,
  counts_as_seller boolean not null default true,
  color text
);
insert into public.seller_kinds(kind, label, counts_as_seller, color) values
  ('seller', 'Seller', true, '#d7301f'),
  ('dropoff_agency', 'Centro de envío', false, '#2b8cbe'),
  ('partner', 'Self-service partner', true, '#7a0177'),
  ('unknown', 'Unknown', true, '#737373')
on conflict (kind) do nothing;

-- Clean: physical pickup locations (many sellers can share one door)
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  address_key text not null unique,        -- normalized dedupe key
  street text,
  street_number text,
  address_display text not null,
  locality text,                            -- barrio (CABA) or localidad (GBA)
  partido text,                             -- comuna/partido
  province text,                            -- 'CABA' | 'Buenos Aires' | ...
  postal_code text,
  lat double precision,
  lng double precision,
  h3_r9 text,
  geocode_provider text,                    -- georef | google | source | manual | null
  geocode_confidence numeric,
  geocode_raw jsonb,
  geocode_status text not null default 'pending', -- pending | ok | failed | review
  manual_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists locations_h3_idx on public.locations(h3_r9);
create index if not exists locations_status_idx on public.locations(geocode_status);

-- Clean: sellers
create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  kind text not null default 'seller' references public.seller_kinds(kind),
  parent_external_id text,
  name text not null,
  location_id uuid references public.locations(id),
  source text not null default 'meli',
  opening_hours text,
  phone text,
  note_raw text,
  note_address text,                        -- alternate address found in the note (flag only)
  extra jsonb not null default '{}'::jsonb, -- any source column we did not model
  row_hash text,
  first_batch_id uuid references public.import_batches(id),
  last_seen_batch_id uuid references public.import_batches(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sellers_location_idx on public.sellers(location_id);
create index if not exists sellers_kind_idx on public.sellers(kind);
create index if not exists sellers_active_idx on public.sellers(active);

-- Metrics arrive as rows, never as columns
create table if not exists public.seller_metrics (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  metric text not null,                     -- e.g. avg_monthly_volume
  period text,                              -- e.g. 2026-08, 2026, null for static
  value numeric not null,
  batch_id uuid references public.import_batches(id),
  created_at timestamptz not null default now(),
  unique (seller_id, metric, period)
);

-- Shared geocode cache across all files
create table if not exists public.geocode_cache (
  address_key text primary key,
  provider text not null,
  lat double precision,
  lng double precision,
  confidence numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- Rows that need a human
create table if not exists public.review_items (
  id bigint generated always as identity primary key,
  batch_id uuid references public.import_batches(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  reason text not null,                     -- geocode_failed | address_conflict | outside_region | ...
  payload jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_items_open_idx on public.review_items(resolved) where resolved = false;

-- updated_at triggers
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists locations_updated_at on public.locations;
create trigger locations_updated_at before update on public.locations for each row execute function public.set_updated_at();
drop trigger if exists sellers_updated_at on public.sellers;
create trigger sellers_updated_at before update on public.sellers for each row execute function public.set_updated_at();

-- Lock everything down: the app reads with the secret key only
alter table public.import_batches enable row level security;
alter table public.raw_rows enable row level security;
alter table public.seller_kinds enable row level security;
alter table public.locations enable row level security;
alter table public.sellers enable row level security;
alter table public.seller_metrics enable row level security;
alter table public.geocode_cache enable row level security;
alter table public.review_items enable row level security;

-- Read view for the map: no phone, no raw note
create or replace view public.map_sellers with (security_invoker = true) as
select s.id, s.external_id, s.kind, k.label as kind_label, k.counts_as_seller, s.name, s.source,
       s.opening_hours, s.note_address, s.active,
       l.id as location_id, l.address_display, l.locality, l.partido, l.province, l.postal_code,
       l.lat, l.lng, l.h3_r9, l.geocode_status
from public.sellers s
join public.seller_kinds k on k.kind = s.kind
left join public.locations l on l.id = s.location_id;
