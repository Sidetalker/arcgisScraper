create table if not exists public.listing_comments (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists listing_comments_listing_id_created_at_idx
  on public.listing_comments (listing_id, created_at desc);

alter table public.listing_comments disable row level security;

grant select, insert, update, delete on public.listing_comments to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'listing_comments'
    ) then
      alter publication supabase_realtime add table public.listing_comments;
    end if;
  end if;
end;
$$;
