-- Primary listings table storing the denormalised Summit County STR dataset
create table if not exists public.listings (
  id text primary key,
  complex text,
  unit text,
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
  schedule_number text,
  public_detail_url text,
  physical_address text,
  is_business_owner boolean,
  latitude double precision,
  longitude double precision,
  estimated_renewal_date date,
  estimated_renewal_method text,
  estimated_renewal_reference date,
  estimated_renewal_category text default 'missing',
  estimated_renewal_month_key text,
  distance_to_ev_station_meters double precision,
  raw jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Helpful indexes for common filters/aggregations
create index if not exists listings_schedule_number_idx
  on public.listings (schedule_number);

create index if not exists listings_subdivision_idx
  on public.listings (subdivision);

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
