-- Creates a view that joins listings with their waitlist entries.
create or replace view public.listings_with_waitlist as
select
  l.*,
  w.waitlist_type,
  w.position as waitlist_position
from
  public.listings as l
left join
  public.waitlist_entry_matches as m on l.id = m.listing_id
left join
  public.waitlist_entries as w on m.entry_id = w.id;

grant select on public.listings_with_waitlist to anon, authenticated;
