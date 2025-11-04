import { normaliseTableState, type ListingTableState } from '@/constants/listingTable';
import { assertSupabaseClient } from '@/services/supabaseClient';
import { cloneRegionShape, normaliseRegionList } from '@/services/regionShapes';
import {
  type ConfigurationProfile,
  type ListingFilters,
  type RegionShape,
} from '@/types';

interface ConfigurationProfileRow {
  id: string;
  name: string;
  filters: ListingFilters | null;
  regions: RegionShape[] | null;
  table_state: ListingTableState | null;
  updated_at?: string | null;
}

export interface SaveConfigurationProfileInput {
  id?: string | null;
  name: string;
  filters: ListingFilters;
  regions: RegionShape[];
  table: ListingTableState;
}

function normaliseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (deduped.has(key)) {
      continue;
    }
    deduped.add(key);
    result.push(trimmed);
  }
  return result;
}

function normaliseFilters(filters: ListingFilters | null | undefined): ListingFilters {
  const fallback: ListingFilters = {
    searchTerm: '',
    complex: '',
    owner: '',
    zones: [],
    subdivisions: [],
    renewalCategories: [],
    renewalMethods: [],
    renewalMonths: [],
  };

  if (!filters || typeof filters !== 'object') {
    return { ...fallback };
  }

  return {
    searchTerm: typeof filters.searchTerm === 'string' ? filters.searchTerm : '',
    complex: typeof filters.complex === 'string' ? filters.complex : '',
    owner: typeof filters.owner === 'string' ? filters.owner : '',
    zones: normaliseStringArray(filters.zones),
    subdivisions: normaliseStringArray(filters.subdivisions),
    renewalCategories: normaliseStringArray(filters.renewalCategories),
    renewalMethods: normaliseStringArray(filters.renewalMethods),
    renewalMonths: normaliseStringArray(filters.renewalMonths),
  };
}

function fromRow(row: ConfigurationProfileRow): ConfigurationProfile {
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const normalisedUpdatedAt =
    updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null;

  return {
    id: row.id,
    name: row.name,
    filters: normaliseFilters(row.filters),
    regions: normaliseRegionList(row.regions).map((region) => cloneRegionShape(region)),
    table: normaliseTableState(row.table_state),
    updatedAt: normalisedUpdatedAt,
  };
}

function prepareRow(input: SaveConfigurationProfileInput): Partial<ConfigurationProfileRow> {
  return {
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    filters: input.filters,
    regions: input.regions.map((region) => cloneRegionShape(region)),
    table_state: input.table,
    updated_at: new Date().toISOString(),
  };
}

export async function fetchConfigurationProfiles(): Promise<ConfigurationProfile[]> {
  const client = assertSupabaseClient();

  const { data, error } = await client
    .from('configuration_profiles')
    .select('id, name, filters, regions, table_state, updated_at')
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ConfigurationProfileRow[];
  return rows.map((row) => fromRow(row));
}

export async function saveConfigurationProfile(
  input: SaveConfigurationProfileInput,
): Promise<ConfigurationProfile> {
  const client = assertSupabaseClient();
  const payload = prepareRow(input);

  const { data, error } = await client
    .from('configuration_profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('id, name, filters, regions, table_state, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return fromRow(data as ConfigurationProfileRow);
}
