create extension if not exists "pgcrypto" with schema public;

create table if not exists public.mailing_list_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  status text not null check (status in ('pending', 'processing', 'completed', 'failed')),
  filters jsonb not null,
  regions jsonb not null,
  file_paths jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.mailing_list_exports
  add column if not exists user_id uuid references auth.users (id);

alter table public.mailing_list_exports
  alter column user_id set not null;

alter table public.mailing_list_exports enable row level security;

drop policy if exists "Allow anonymous read" on public.mailing_list_exports;
drop policy if exists "Allow users read" on public.mailing_list_exports;
create policy "Allow users read"
  on public.mailing_list_exports
  for select
  using (auth.uid() = user_id);

drop policy if exists "Allow service role write" on public.mailing_list_exports;
create policy "Allow service role write"
  on public.mailing_list_exports
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into storage.buckets (id, name, public)
values ('mailing-exports', 'mailing-exports', false)
on conflict (id) do nothing;
