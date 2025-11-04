import { normaliseProfileConfiguration } from '@/constants/profiles';
import type { ConfigurationProfile, ProfileConfiguration } from '@/types';
import { assertSupabaseClient } from '@/services/supabaseClient';

interface ConfigurationProfileRow {
  id: string;
  name: string;
  config: ProfileConfiguration | null;
  created_at: string | null;
  updated_at: string | null;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function fromRow(row: ConfigurationProfileRow): ConfigurationProfile {
  return {
    id: row.id,
    name: row.name,
    configuration: normaliseProfileConfiguration(row.config ?? undefined),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

export async function fetchConfigurationProfiles(): Promise<ConfigurationProfile[]> {
  const client = assertSupabaseClient();

  const { data, error } = await client
    .from('configuration_profiles')
    .select('id, name, config, created_at, updated_at')
    .order('updated_at', { ascending: false, nullsLast: true })
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ConfigurationProfileRow[];
  return rows.map(fromRow);
}

export interface SaveConfigurationProfileInput {
  id?: string;
  name: string;
  configuration: ProfileConfiguration;
}

export async function saveConfigurationProfile(
  input: SaveConfigurationProfileInput,
): Promise<ConfigurationProfile> {
  const client = assertSupabaseClient();
  const payload = {
    id: input.id,
    name: input.name,
    config: normaliseProfileConfiguration(input.configuration),
  };

  const query = client
    .from('configuration_profiles')
    .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })
    .select('id, name, config, created_at, updated_at')
    .single();

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return fromRow(data as ConfigurationProfileRow);
}
