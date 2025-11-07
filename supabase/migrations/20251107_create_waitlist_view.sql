-- Description: Creates a view to join listings with their waitlist entries.
-- This view simplifies querying for listings that are on a waitlist,
-- including their position and the waitlist type.

create or replace view public.waitlist_view as
select
  w.id as waitlist_entry_id,
  w.waitlist_type,
  w.position,
  w.address_line1,
  w.address_line2,
  m.listing_id,
  m.match_type,
  m.match_score,
  l.owner_name,
  l.physical_address,
  l.complex
from
  public.waitlist_entries as w
join
  public.waitlist_entry_matches as m on w.id = m.entry_id
join
  public.listings as l on m.listing_id = l.id;

grant select on public.waitlist_view to anon, authenticated;
