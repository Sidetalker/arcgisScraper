-- Introduce an owner blacklist table and expose blacklist state via the listings view.
create table if not exists public.owner_blacklist (
  owner_normalized text primary key,
  owner_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.owner_blacklist disable row level security;

grant select, insert, update, delete on public.owner_blacklist to anon, authenticated;

drop trigger if exists set_owner_blacklist_updated_at on public.owner_blacklist;
create trigger set_owner_blacklist_updated_at
before update on public.owner_blacklist
for each row
execute procedure public.touch_updated_at();

create or replace view public.listings_with_waitlist as
select
  l.*,
  w.waitlist_type,
  w.position as waitlist_position,
  exists (
    select 1
    from public.owner_blacklist as b
    where b.owner_normalized = trim(lower(l.owner_name))
      or exists (
        select 1
        from unnest(coalesce(l.owner_names, array[]::text[])) as owner_name(value)
        where b.owner_normalized = trim(lower(value))
      )
  ) as is_owner_blacklisted
from
  public.listings as l
left join
  public.waitlist_entry_matches as m on l.id = m.listing_id
left join
  public.waitlist_entries as w on m.entry_id = w.id;

grant select on public.listings_with_waitlist to anon, authenticated;
