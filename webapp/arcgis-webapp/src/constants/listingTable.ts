export const LISTING_TABLE_COLUMN_KEYS = [
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
  'strLicenseId',
  'strLicenseStatus',
  'physicalAddress',
] as const;

export type ListingTableColumnKey = (typeof LISTING_TABLE_COLUMN_KEYS)[number];

export type ListingTableColumnFilters = Record<ListingTableColumnKey, string>;

export type ListingTableSortDirection = 'asc' | 'desc';

export interface ListingTableSort {
  columnKey: ListingTableColumnKey;
  direction: ListingTableSortDirection;
}

export interface ListingTableState {
  columnOrder: ListingTableColumnKey[];
  hiddenColumns: ListingTableColumnKey[];
  columnFilters: ListingTableColumnFilters;
  sort: ListingTableSort | null;
}

export function isListingTableColumnKey(value: unknown): value is ListingTableColumnKey {
  return (
    typeof value === 'string' &&
    (LISTING_TABLE_COLUMN_KEYS as readonly string[]).includes(value)
  );
}

export function createDefaultColumnOrder(): ListingTableColumnKey[] {
  return [...LISTING_TABLE_COLUMN_KEYS];
}

export function createDefaultHiddenColumns(): ListingTableColumnKey[] {
  return [];
}

export function createDefaultColumnFilters(): ListingTableColumnFilters {
  return LISTING_TABLE_COLUMN_KEYS.reduce<ListingTableColumnFilters>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as ListingTableColumnFilters);
}

export function createDefaultSort(): ListingTableSort | null {
  return null;
}

export function createDefaultTableState(): ListingTableState {
  return {
    columnOrder: createDefaultColumnOrder(),
    hiddenColumns: createDefaultHiddenColumns(),
    columnFilters: createDefaultColumnFilters(),
    sort: createDefaultSort(),
  };
}

export function normaliseColumnOrder(order: unknown): ListingTableColumnKey[] {
  const defaultOrder = createDefaultColumnOrder();
  if (!Array.isArray(order)) {
    return defaultOrder;
  }

  const seen = new Set<ListingTableColumnKey>();
  const valid: ListingTableColumnKey[] = [];

  for (const value of order) {
    if (isListingTableColumnKey(value) && !seen.has(value)) {
      valid.push(value);
      seen.add(value);
    }
  }

  for (const key of defaultOrder) {
    if (!seen.has(key)) {
      valid.push(key);
    }
  }

  return valid;
}

export function normaliseHiddenColumns(hidden: unknown): ListingTableColumnKey[] {
  if (!Array.isArray(hidden)) {
    return createDefaultHiddenColumns();
  }

  const requested = new Set<ListingTableColumnKey>();
  for (const value of hidden) {
    if (isListingTableColumnKey(value)) {
      requested.add(value);
    }
  }

  const defaultOrder = createDefaultColumnOrder();
  return defaultOrder.filter((key) => requested.has(key));
}

export function normaliseColumnFilters(filters: unknown): ListingTableColumnFilters {
  const base = createDefaultColumnFilters();
  if (!filters || typeof filters !== 'object') {
    return base;
  }

  for (const key of LISTING_TABLE_COLUMN_KEYS) {
    const value = (filters as Record<string, unknown>)[key];
    base[key] = typeof value === 'string' ? value : '';
  }

  return base;
}

function isSortDirection(value: unknown): value is ListingTableSortDirection {
  return value === 'asc' || value === 'desc';
}

export function normaliseSort(sort: unknown): ListingTableSort | null {
  if (!sort || typeof sort !== 'object') {
    return createDefaultSort();
  }

  const sortObject = sort as Record<string, unknown>;
  const columnKey = sortObject.columnKey;
  const direction = sortObject.direction;

  if (!isListingTableColumnKey(columnKey) || !isSortDirection(direction)) {
    return createDefaultSort();
  }

  return {
    columnKey,
    direction,
  };
}

export function normaliseTableState(table: unknown): ListingTableState {
  if (!table || typeof table !== 'object') {
    return createDefaultTableState();
  }

  const tableObject = table as Record<string, unknown>;
  return {
    columnOrder: normaliseColumnOrder(tableObject.columnOrder),
    hiddenColumns: normaliseHiddenColumns(tableObject.hiddenColumns),
    columnFilters: normaliseColumnFilters(tableObject.columnFilters),
    sort: normaliseSort(tableObject.sort),
  };
}

export function areColumnOrdersEqual(
  a: ListingTableColumnKey[],
  b: ListingTableColumnKey[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((key, index) => key === b[index]);
}

export function areHiddenColumnsEqual(
  a: ListingTableColumnKey[],
  b: ListingTableColumnKey[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((key, index) => key === b[index]);
}

export function areColumnFiltersEqual(
  a: ListingTableColumnFilters,
  b: ListingTableColumnFilters,
): boolean {
  return LISTING_TABLE_COLUMN_KEYS.every((key) => a[key] === b[key]);
}

export function areSortsEqual(a: ListingTableSort | null, b: ListingTableSort | null): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.columnKey === b.columnKey && a.direction === b.direction;
}

export function areTableStatesEqual(a: ListingTableState, b: ListingTableState): boolean {
  return (
    areColumnOrdersEqual(a.columnOrder, b.columnOrder) &&
    areHiddenColumnsEqual(a.hiddenColumns, b.hiddenColumns) &&
    areColumnFiltersEqual(a.columnFilters, b.columnFilters) &&
    areSortsEqual(a.sort, b.sort)
  );
}

