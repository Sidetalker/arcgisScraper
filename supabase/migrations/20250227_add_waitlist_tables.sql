-- Create waitlist tables for Upper/Lower Blue Basin imports.
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

alter table if exists public.waitlist_entries disable row level security;
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

alter table if exists public.waitlist_entry_matches disable row level security;
grant select, insert, update, delete on public.waitlist_entry_matches to anon, authenticated;
