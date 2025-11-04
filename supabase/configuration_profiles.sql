-- Create configuration_profiles table to store shared listing filters and map regions
drop table if exists public.configuration_profiles cascade;

create table if not exists public.configuration_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  regions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure profile names are unique case-insensitively
create unique index if not exists configuration_profiles_name_key
  on public.configuration_profiles (lower(name));

-- Disable row level security so profiles are publicly readable
alter table public.configuration_profiles disable row level security;

-- Allow anonymous and authenticated roles to manage profiles
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.configuration_profiles to anon, authenticated;

-- Maintain updated_at automatically on changes
create or replace function public.update_configuration_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_configuration_profiles_updated_at
before update on public.configuration_profiles
for each row
execute procedure public.update_configuration_profiles_updated_at();
