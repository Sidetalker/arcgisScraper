-- Add export_columns field to configuration_profiles table
-- This field stores the list of columns to include in CSV exports and their order

alter table public.configuration_profiles
add column if not exists export_columns jsonb not null default '[]'::jsonb;

-- Add a comment to explain the column
comment on column public.configuration_profiles.export_columns is 
'Array of column keys that defines which columns to export in CSV and their order';
