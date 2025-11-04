import type { ListingTableColumnKey, ListingTableViewState } from '@/types';

export const LISTING_TABLE_COLUMN_KEYS: ListingTableColumnKey[] = [
  'complex',
  'unit',
  'owners',
  'business',
  'mailingAddress',
  'mailingCity',
  'mailingState',
  'mailingZip',
  'subdivision',
  'scheduleNumber',
  'physicalAddress',
];

export function isListingTableColumnKey(value: unknown): value is ListingTableColumnKey {
  return typeof value === 'string' && (LISTING_TABLE_COLUMN_KEYS as readonly string[]).includes(value);
}

export function createDefaultListingTableViewState(): ListingTableViewState {
  const columnFilters = LISTING_TABLE_COLUMN_KEYS.reduce(
    (acc, key) => {
      acc[key] = '';
      return acc;
    },
    {} as ListingTableViewState['columnFilters'],
  );

  return {
    columnOrder: [...LISTING_TABLE_COLUMN_KEYS],
    hiddenColumns: [],
    columnFilters,
  };
}

export function normaliseListingTableViewState(
  input: Partial<ListingTableViewState> | null | undefined,
): ListingTableViewState {
  const defaults = createDefaultListingTableViewState();
  if (!input) {
    return defaults;
  }

  const initialOrder = Array.isArray(input.columnOrder)
    ? input.columnOrder.filter((key): key is ListingTableColumnKey => isListingTableColumnKey(key))
    : defaults.columnOrder;

  const columnOrder = [...initialOrder, ...defaults.columnOrder].filter(
    (key, index, array) => array.indexOf(key) === index,
  );

  const hiddenColumns = Array.isArray(input.hiddenColumns)
    ? input.hiddenColumns.filter((key): key is ListingTableColumnKey => isListingTableColumnKey(key))
    : defaults.hiddenColumns;

  const columnFilters = { ...defaults.columnFilters };
  if (input.columnFilters && typeof input.columnFilters === 'object') {
    for (const key of Object.keys(input.columnFilters)) {
      if (isListingTableColumnKey(key)) {
        const value = input.columnFilters[key];
        columnFilters[key] = typeof value === 'string' ? value : defaults.columnFilters[key];
      }
    }
  }

  return {
    columnOrder,
    hiddenColumns,
    columnFilters,
  };
}
