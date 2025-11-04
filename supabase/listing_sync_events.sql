-- Track ArcGIS listing sync runs and outcomes
create table if not exists public.listing_sync_events (
  id uuid primary key default gen_random_uuid(),
  triggered_by text not null check (triggered_by in ('manual', 'scheduled')),
  status text not null check (status in ('success', 'error')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  previous_total integer,
  current_total integer,
  added_count integer,
  removed_count integer,
  updated_count integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists listing_sync_events_started_at_idx
  on public.listing_sync_events (started_at desc);

alter table public.listing_sync_events disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.listing_sync_events to anon, authenticated;
