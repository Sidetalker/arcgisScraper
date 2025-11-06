import {
  type ListingTableColumnFilters,
  type ListingTableColumnKey,
} from '@/constants/listingTable';
import type { ListingRecord } from '@/types';

export function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function toUniqueOwners(listing: ListingRecord): string[] {
  return Array.from(
    new Set(
      listing.ownerNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  );
}

export function fuzzyMatch(haystack: string, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (query.length === 0) {
    return true;
  }

  const source = haystack.toLowerCase();
  let position = 0;

  for (const char of query) {
    const foundIndex = source.indexOf(char, position);
    if (foundIndex === -1) {
      return false;
    }
    position = foundIndex + 1;
  }

  return true;
}

type ListingColumnFilterDefinition = {
  key: ListingTableColumnKey;
  getFilterValue: (listing: ListingRecord) => string;
  filterType?: 'text' | 'boolean';
};

const COLUMN_FILTER_DEFINITIONS: Record<
  ListingTableColumnKey,
  ListingColumnFilterDefinition
> = {
  complex: {
    key: 'complex',
    getFilterValue: (listing) => normalizeText(listing.complex),
  },
  unit: {
    key: 'unit',
    getFilterValue: (listing) => normalizeText(listing.unit),
  },
  owners: {
    key: 'owners',
    getFilterValue: (listing) => normalizeText(listing.ownerNames.join(' ')),
  },
  business: {
    key: 'business',
    filterType: 'boolean',
    getFilterValue: (listing) => (listing.isBusinessOwner ? 'yes' : 'no'),
  },
  mailingAddress: {
    key: 'mailingAddress',
    getFilterValue: (listing) => normalizeText(listing.mailingAddress),
  },
  mailingCity: {
    key: 'mailingCity',
    getFilterValue: (listing) => normalizeText(listing.mailingCity),
  },
  mailingState: {
    key: 'mailingState',
    getFilterValue: (listing) => normalizeText(listing.mailingState),
  },
  mailingZip: {
    key: 'mailingZip',
    getFilterValue: (listing) =>
      normalizeText(listing.mailingZip9 || listing.mailingZip5),
  },
  subdivision: {
    key: 'subdivision',
    getFilterValue: (listing) => normalizeText(listing.subdivision),
  },
  scheduleNumber: {
    key: 'scheduleNumber',
    getFilterValue: (listing) => normalizeText(listing.scheduleNumber),
  },
  physicalAddress: {
    key: 'physicalAddress',
    getFilterValue: (listing) => normalizeText(listing.physicalAddress),
  },
};

export function filterListingsByColumnFilters(
  listings: ListingRecord[],
  columnFilters: ListingTableColumnFilters,
): ListingRecord[] {
  const activeEntries = Object.entries(columnFilters).filter(([, value]) =>
    value.trim().length > 0,
  ) as [ListingTableColumnKey, string][];

  if (activeEntries.length === 0) {
    return listings;
  }

  return listings.filter((listing) =>
    activeEntries.every(([columnKey, query]) => {
      const definition = COLUMN_FILTER_DEFINITIONS[columnKey];
      if (!definition) {
        return true;
      }

      if (definition.filterType === 'boolean') {
        if (query === 'all') {
          return true;
        }
        return definition.getFilterValue(listing) === query;
      }

      return fuzzyMatch(definition.getFilterValue(listing), query);
    }),
  );
}

export function getColumnFilterDefinition(
  key: ListingTableColumnKey,
): ListingColumnFilterDefinition {
  return COLUMN_FILTER_DEFINITIONS[key];
}
