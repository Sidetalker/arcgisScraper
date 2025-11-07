-- Primary listings table storing the denormalised Summit County STR dataset
drop table if exists public.listings cascade;

create table if not exists public.listings (
  id text primary key,
  complex text,
  unit text,
  unit_normalized text,
  owner_name text,
  owner_names text[],
  mailing_address text,
  mailing_address_line1 text,
  mailing_address_line2 text,
  mailing_city text,
  mailing_state text,
  mailing_zip5 text,
  mailing_zip9 text,
  subdivision text,
  zone text,
  schedule_number text,
  public_detail_url text,
  physical_address text,
  is_business_owner boolean,
  is_favorited boolean not null default false,
  latitude double precision,
  longitude double precision,
  estimated_renewal_date date,
  estimated_renewal_method text,
  estimated_renewal_reference date,
  estimated_renewal_category text default 'missing',
  estimated_renewal_month_key text,
  nearest_ev_station_distance_meters double precision,
  raw jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Helpful indexes for common filters/aggregations
create index if not exists listings_schedule_number_idx
  on public.listings (schedule_number);

create index if not exists listings_subdivision_idx
  on public.listings (subdivision);

create index if not exists listings_zone_idx
  on public.listings (zone);

create index if not exists listings_unit_normalized_idx
  on public.listings (unit_normalized);

create index if not exists listings_is_favorited_idx
  on public.listings (is_favorited);

create index if not exists listings_estimated_renewal_month_key_idx
  on public.listings (estimated_renewal_month_key);

create index if not exists listings_estimated_renewal_category_idx
  on public.listings (estimated_renewal_category);

-- Disable row level security so anon clients can read/write listings directly.
alter table public.listings disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.listings to anon, authenticated;

-- Maintain updated_at automatically on updates
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_listings_updated_at on public.listings;
create trigger set_listings_updated_at
before update on public.listings
for each row
execute procedure public.touch_updated_at();

-- Store per-listing customization overrides keyed by listing id.
drop table if exists public.listing_customizations cascade;

create table if not exists public.listing_customizations (
  listing_id text primary key references public.listings(id) on delete cascade,
  overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists listing_customizations_updated_at_idx
  on public.listing_customizations (updated_at desc);

alter table public.listing_customizations disable row level security;

grant select, insert, update, delete on public.listing_customizations to anon, authenticated;

drop trigger if exists set_listing_customizations_updated_at on public.listing_customizations;
create trigger set_listing_customizations_updated_at
before update on public.listing_customizations
for each row
execute procedure public.touch_updated_at();

-- Store free-form comments for each listing row.
create table if not exists public.listing_comments (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists listing_comments_listing_id_created_at_idx
  on public.listing_comments (listing_id, created_at desc);

alter table public.listing_comments disable row level security;

grant select, insert, update, delete on public.listing_comments to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'listing_comments'
    ) then
      alter publication supabase_realtime add table public.listing_comments;
    end if;
  end if;
end;
$$;

drop table if exists public.watchlist_listings cascade;
drop table if exists public.watchlists cascade;

-- Shared watchlists allow teams to group and track listings.
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

-- Persist Upper/Lower Blue Basin waitlists imported from municipal spreadsheets.
drop table if exists public.waitlist_entry_matches cascade;
drop table if exists public.waitlist_entries cascade;

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  waitlist_type text not null check (char_length(waitlist_type) > 0),
  position integer,
  address_line1 text not null,
  address_line2 text,
  normalized_address text not null,
  normalized_line1 text not null,
  normalized_line2 text,
  source_filename text,
  source_row_number integer,
  raw jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists waitlist_entries_type_position_idx
  on public.waitlist_entries (waitlist_type, position)
  where position is not null;

create unique index if not exists waitlist_entries_type_address_idx
  on public.waitlist_entries (waitlist_type, normalized_address);

create index if not exists waitlist_entries_type_idx
  on public.waitlist_entries (waitlist_type);

alter table public.waitlist_entries disable row level security;
grant select, insert, update, delete on public.waitlist_entries to anon, authenticated;

create table if not exists public.waitlist_entry_matches (
  entry_id uuid not null references public.waitlist_entries(id) on delete cascade,
  listing_id text not null references public.listings(id) on delete cascade,
  match_type text not null check (char_length(match_type) > 0),
  match_score double precision,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (entry_id, listing_id)
);

create index if not exists waitlist_entry_matches_listing_id_idx
  on public.waitlist_entry_matches (listing_id);

alter table public.waitlist_entry_matches disable row level security;
grant select, insert, update, delete on public.waitlist_entry_matches to anon, authenticated;
