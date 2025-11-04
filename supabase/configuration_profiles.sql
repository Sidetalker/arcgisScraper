create extension if not exists "pgcrypto";

create table if not exists public.configuration_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  config jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists configuration_profiles_name_idx
  on public.configuration_profiles (lower(name));

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_configuration_profiles_updated_at
before update on public.configuration_profiles
for each row
execute procedure public.update_updated_at_column();

alter table public.configuration_profiles disable row level security;
