alter table public.listings
  add column if not exists str_license_id text,
  add column if not exists str_license_status text,
  add column if not exists str_license_status_normalized text default 'unknown',
  add column if not exists str_license_updated_at timestamptz;

alter table public.listings
  alter column str_license_status_normalized set default 'unknown';

update public.listings
set str_license_status_normalized = coalesce(str_license_status_normalized, 'unknown');

create index if not exists listings_str_license_status_normalized_idx
  on public.listings (str_license_status_normalized);
