-- Hex columns for the ranking and any future SQL catchment. Postgres here has no h3 extension;
-- the parent of an H3 cell is bit arithmetic on its 64-bit index: set the resolution nibble and
-- fill finer digits with 7. Locked to h3-js by tests/unit/h3Parent.test.ts.
create or replace function public.h3_parent(cell text, res integer) returns text
language sql immutable strict parallel safe as $$
  select to_hex(
    (('x' || lpad(cell, 16, '0'))::bit(64)::bigint & ~(15::bigint << 52))
    | (res::bigint << 52)
    | ((1::bigint << (45 - 3 * res)) - 1)
  )
$$;

alter table public.locations
  add column if not exists h3_r8 text generated always as (public.h3_parent(h3_r9, 8)) stored,
  add column if not exists h3_r7 text generated always as (public.h3_parent(h3_r9, 7)) stored;
create index if not exists locations_h3_r8_idx on public.locations(h3_r8);
create index if not exists locations_h3_r7_idx on public.locations(h3_r7);
