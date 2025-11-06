create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.watchlist_listings (
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  listing_id text not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (watchlist_id, listing_id)
);

alter table public.watchlists disable row level security;
alter table public.watchlist_listings disable row level security;

grant select, insert, update, delete on public.watchlists to anon, authenticated;
grant select, insert, update, delete on public.watchlist_listings to anon, authenticated;

drop trigger if exists set_watchlists_updated_at on public.watchlists;
create trigger set_watchlists_updated_at
before update on public.watchlists
for each row
execute procedure public.touch_updated_at();
