-- Adds the is_favorited flag to the listings table without dropping existing data.
alter table if exists public.listings
  add column if not exists is_favorited boolean not null default false;

-- Ensure historical rows are initialised with the default value.
update public.listings
  set is_favorited = coalesce(is_favorited, false);

-- Provide an index to accelerate favourite-only queries.
create index if not exists listings_is_favorited_idx
  on public.listings (is_favorited);
