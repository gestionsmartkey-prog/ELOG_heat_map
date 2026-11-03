-- Typed, indexed filter columns derived from attrs/extra. Generated, so the pipeline keeps writing
-- attrs/extra as today and these can never disagree with them.

alter table public.sellers
  add column if not exists flex_candidate text
    generated always as (nullif(attrs->>'flex_candidate', '')) stored,
  add column if not exists reputation_rank smallint
    generated always as (case when attrs->>'reputation' ~ '^[1-5]_' then left(attrs->>'reputation', 1)::smallint end) stored,
  add column if not exists power_seller_rank smallint
    generated always as (case attrs->>'power_seller' when 'silver' then 1 when 'gold' then 2 when 'platinum' then 3 end) stored,
  -- One category per seller today; an array so a multi-category source fits later without a migration.
  add column if not exists categories text[]
    generated always as (case when nullif(extra->>'categories', '') is not null then array[extra->>'categories'] end) stored,
  add column if not exists profile_url text
    generated always as (nullif(extra->>'profile_url', '')) stored;

create index if not exists sellers_flex_candidate_idx on public.sellers(flex_candidate);
create index if not exists sellers_reputation_rank_idx on public.sellers(reputation_rank);
create index if not exists sellers_power_seller_rank_idx on public.sellers(power_seller_rank);
create index if not exists sellers_categories_idx on public.sellers using gin(categories);
