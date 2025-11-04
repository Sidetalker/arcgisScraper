-- Reset table so syncs rebuild a fresh dataset
drop table if exists public.listings cascade;

-- Base listings table that mirrors the structure expected by the scraper,
-- Supabase sync worker, and the React client. The script is idempotent so it
-- can be re-run to ensure required columns, grants, and triggers exist.

create table if not exists public.listings (
  id text primary key,
  complex text,
  unit text,
  owner_name text,
  owner_names text[] default '{}'::text[],
  mailing_address text,
  mailing_address_line1 text,
  mailing_address_line2 text,
  mailing_city text,
  mailing_state text,
  mailing_zip5 text,
  mailing_zip9 text,
  subdivision text,
  schedule_number text,
  public_detail_url text,
  physical_address text,
  town_name text,
  zone_name text,
  zoning_type text,
  brief_property_description text,
  situs_address_type_description text,
  is_business_owner boolean,
  latitude double precision,
  longitude double precision,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.listings
  alter column owner_names set default '{}'::text[];

-- Ensure the latest metadata columns exist even if the table pre-dates them.
alter table public.listings add column if not exists town_name text;
alter table public.listings add column if not exists zone_name text;
alter table public.listings add column if not exists zoning_type text;
alter table public.listings add column if not exists brief_property_description text;
alter table public.listings add column if not exists situs_address_type_description text;

-- Make the raw payload mandatory so Supabase retains the full ArcGIS feature.
alter table public.listings alter column raw set not null;
alter table public.listings alter column raw set default '{}'::jsonb;

-- Allow anonymous clients to query the listings while keeping writes restricted
-- to service role keys.
alter table public.listings disable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.listings to anon, authenticated;

grant usage on schema public to service_role;
grant insert, update, delete on public.listings to service_role;

-- Maintain updated_at automatically when rows change.
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

-- Helpful indexes for common lookups and ordering in the client.
create index if not exists listings_schedule_number_idx on public.listings (schedule_number);
create index if not exists listings_subdivision_idx on public.listings (subdivision);
create index if not exists listings_updated_at_idx on public.listings (updated_at);
