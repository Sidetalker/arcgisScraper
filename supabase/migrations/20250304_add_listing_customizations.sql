-- Creates listing_customizations table to store per-listing override data.
create table if not exists public.listing_customizations (
  listing_id text primary key references public.listings(id) on delete cascade,
  overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists listing_customizations_updated_at_idx
  on public.listing_customizations (updated_at desc);

alter table if exists public.listing_customizations disable row level security;

grant select, insert, update, delete on public.listing_customizations to anon, authenticated;

drop trigger if exists set_listing_customizations_updated_at on public.listing_customizations;
create trigger set_listing_customizations_updated_at
before update on public.listing_customizations
for each row
execute procedure public.touch_updated_at();
