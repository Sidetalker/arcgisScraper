-- Adds a derived unit_normalized column for canonical unit lookups.
alter table if exists public.listings
  add column if not exists unit_normalized text;

create index if not exists listings_unit_normalized_idx
  on public.listings (unit_normalized);
