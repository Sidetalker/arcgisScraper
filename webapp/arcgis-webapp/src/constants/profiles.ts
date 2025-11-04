import { DEFAULT_FILTERS } from '@/constants/listings';
import {
  createDefaultListingTableViewState,
  normaliseListingTableViewState,
} from '@/constants/listingTable';
import type { ProfileConfiguration } from '@/types';

export const DEFAULT_PROFILE_NAME = 'Untitled profile';

export function createDefaultProfileConfiguration(): ProfileConfiguration {
  return {
    filters: { ...DEFAULT_FILTERS },
    regions: [],
    table: createDefaultListingTableViewState(),
  };
}

export function normaliseProfileConfiguration(
  input: Partial<ProfileConfiguration> | null | undefined,
): ProfileConfiguration {
  const defaults = createDefaultProfileConfiguration();
  if (!input) {
    return defaults;
  }

  const filters = {
    searchTerm: typeof input.filters?.searchTerm === 'string' ? input.filters.searchTerm : defaults.filters.searchTerm,
    complex: typeof input.filters?.complex === 'string' ? input.filters.complex : defaults.filters.complex,
    owner: typeof input.filters?.owner === 'string' ? input.filters.owner : defaults.filters.owner,
  };

  const regions = Array.isArray(input.regions)
    ? input.regions
        .filter((region) =>
          region &&
          typeof region.lat === 'number' &&
          typeof region.lng === 'number' &&
          typeof region.radius === 'number' &&
          Number.isFinite(region.lat) &&
          Number.isFinite(region.lng) &&
          Number.isFinite(region.radius) &&
          region.radius > 0,
        )
        .map((region) => ({
          lat: region.lat,
          lng: region.lng,
          radius: region.radius,
        }))
    : defaults.regions;

  const table = normaliseListingTableViewState(input.table);

  return {
    filters,
    regions,
    table,
  };
}
