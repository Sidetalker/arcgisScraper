-- Aggregated metrics for listings

-- Reset tables so syncs rebuild a fresh dataset
drop table if exists public.listing_subdivision_metrics cascade;
drop table if exists public.listing_zoning_metrics cascade;
drop table if exists public.listing_land_use_metrics cascade;
drop table if exists public.listing_renewal_metrics cascade;
drop table if exists public.listing_renewal_summary cascade;
drop table if exists public.listing_renewal_method_summary cascade;

-- Subdivision metrics store the latest counts per subdivision and allow the
-- frontend to highlight neighbourhood saturation.
create table if not exists public.listing_subdivision_metrics (
  subdivision text primary key,
  total_listings integer not null,
  business_owner_count integer not null,
  individual_owner_count integer not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.listing_zoning_metrics (
  zoning_district text primary key,
  total_listings integer not null,
  business_owner_count integer not null,
  individual_owner_count integer not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.listing_land_use_metrics (
  land_use_category text primary key,
  total_listings integer not null,
  business_owner_count integer not null,
  individual_owner_count integer not null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Renewal metrics capture the number of inferred license renewals in a given month.
create table if not exists public.listing_renewal_metrics (
  renewal_month date primary key,
  listing_count integer not null,
  earliest_renewal date,
  latest_renewal date,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Renewal summary buckets help the UI surface badges for near-term estimated
-- renewals and highlight missing data.
create table if not exists public.listing_renewal_summary (
  category text primary key,
  listing_count integer not null,
  window_start date,
  window_end date,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Renewal estimation methods capture how inferred renewal dates were derived.
create table if not exists public.listing_renewal_method_summary (
  method text primary key,
  listing_count integer not null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Disable row-level security so anonymous clients can read the precomputed
-- aggregates (writes still require the service role key).
alter table public.listing_subdivision_metrics disable row level security;
alter table public.listing_zoning_metrics disable row level security;
alter table public.listing_land_use_metrics disable row level security;
alter table public.listing_renewal_metrics disable row level security;
alter table public.listing_renewal_summary disable row level security;
alter table public.listing_renewal_method_summary disable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.listing_subdivision_metrics to anon, authenticated;
grant select on public.listing_zoning_metrics to anon, authenticated;
grant select on public.listing_land_use_metrics to anon, authenticated;
grant select on public.listing_renewal_metrics to anon, authenticated;
grant select on public.listing_renewal_summary to anon, authenticated;
grant select on public.listing_renewal_method_summary to anon, authenticated;

-- Shared trigger to maintain updated_at
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_listing_subdivision_metrics_updated_at on public.listing_subdivision_metrics;
create trigger set_listing_subdivision_metrics_updated_at
before update on public.listing_subdivision_metrics
for each row
execute procedure public.touch_updated_at();

drop trigger if exists set_listing_zoning_metrics_updated_at on public.listing_zoning_metrics;
create trigger set_listing_zoning_metrics_updated_at
before update on public.listing_zoning_metrics
for each row
execute procedure public.touch_updated_at();

drop trigger if exists set_listing_land_use_metrics_updated_at on public.listing_land_use_metrics;
create trigger set_listing_land_use_metrics_updated_at
before update on public.listing_land_use_metrics
for each row
execute procedure public.touch_updated_at();

drop trigger if exists set_listing_renewal_metrics_updated_at on public.listing_renewal_metrics;
create trigger set_listing_renewal_metrics_updated_at
before update on public.listing_renewal_metrics
for each row
execute procedure public.touch_updated_at();

drop trigger if exists set_listing_renewal_summary_updated_at on public.listing_renewal_summary;
create trigger set_listing_renewal_summary_updated_at
before update on public.listing_renewal_summary
for each row
execute procedure public.touch_updated_at();

drop trigger if exists set_listing_renewal_method_summary_updated_at on public.listing_renewal_method_summary;
create trigger set_listing_renewal_method_summary_updated_at
before update on public.listing_renewal_method_summary
for each row
execute procedure public.touch_updated_at();

-- Views expose consumer-friendly projections for the frontend.
create or replace view public.listing_subdivision_overview as
select
  subdivision,
  total_listings,
  business_owner_count,
  individual_owner_count,
  updated_at
from public.listing_subdivision_metrics
order by total_listings desc, subdivision asc;

grant select on public.listing_subdivision_overview to anon, authenticated;

create or replace view public.listing_zoning_overview as
select
  zoning_district,
  total_listings,
  business_owner_count,
  individual_owner_count,
  updated_at
from public.listing_zoning_metrics
order by total_listings desc, zoning_district asc;

grant select on public.listing_zoning_overview to anon, authenticated;

create or replace view public.listing_land_use_overview as
select
  land_use_category,
  total_listings,
  business_owner_count,
  individual_owner_count,
  updated_at
from public.listing_land_use_metrics
order by total_listings desc, land_use_category asc;

grant select on public.listing_land_use_overview to anon, authenticated;

create or replace view public.listing_renewal_timeline as
select
  renewal_month,
  listing_count,
  earliest_renewal,
  latest_renewal,
  updated_at
from public.listing_renewal_metrics
order by renewal_month asc;

grant select on public.listing_renewal_timeline to anon, authenticated;

create or replace view public.listing_renewal_summary_view as
select
  category,
  listing_count,
  window_start,
  window_end,
  updated_at
from public.listing_renewal_summary
order by case category
  when 'overdue' then 0
  when 'due_30' then 1
  when 'due_60' then 2
  when 'due_90' then 3
  when 'future' then 4
  when 'missing' then 5
  else 6
end;

grant select on public.listing_renewal_summary_view to anon, authenticated;

create or replace view public.listing_renewal_method_breakdown as
select
  method,
  listing_count,
  updated_at
from public.listing_renewal_method_summary
order by listing_count desc, method asc;

grant select on public.listing_renewal_method_breakdown to anon, authenticated;
