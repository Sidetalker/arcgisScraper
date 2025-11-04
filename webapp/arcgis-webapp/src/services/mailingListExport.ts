import type { ListingRecord } from '@/types';

export const EXPORT_COLUMN_KEYS = [
  'ownerName',
  'mailingAddressLine1',
  'mailingAddressLine2',
  'mailingCity',
  'mailingState',
  'mailingZip',
  'complex',
  'unit',
  'scheduleNumber',
  'physicalAddress',
  'subdivision',
  'isBusinessOwner',
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMN_KEYS)[number];

export interface ExportColumnDefinition {
  key: ExportColumnKey;
  label: string;
  getValue: (listing: ListingRecord) => string;
}

export const EXPORT_COLUMN_DEFINITIONS: ExportColumnDefinition[] = [
  {
    key: 'ownerName',
    label: 'Owner name',
    getValue: (listing) => listing.ownerName || '',
  },
  {
    key: 'mailingAddressLine1',
    label: 'Mailing address line 1',
    getValue: (listing) => listing.mailingAddressLine1 || '',
  },
  {
    key: 'mailingAddressLine2',
    label: 'Mailing address line 2',
    getValue: (listing) => listing.mailingAddressLine2 || '',
  },
  {
    key: 'mailingCity',
    label: 'Mailing city',
    getValue: (listing) => listing.mailingCity || '',
  },
  {
    key: 'mailingState',
    label: 'Mailing state',
    getValue: (listing) => listing.mailingState || '',
  },
  {
    key: 'mailingZip',
    label: 'Mailing ZIP',
    getValue: (listing) => listing.mailingZip9 || listing.mailingZip5 || '',
  },
  {
    key: 'complex',
    label: 'Complex',
    getValue: (listing) => listing.complex || '',
  },
  {
    key: 'unit',
    label: 'Unit',
    getValue: (listing) => listing.unit || '',
  },
  {
    key: 'scheduleNumber',
    label: 'Schedule number',
    getValue: (listing) => listing.scheduleNumber || '',
  },
  {
    key: 'physicalAddress',
    label: 'Physical address',
    getValue: (listing) => listing.physicalAddress || '',
  },
  {
    key: 'subdivision',
    label: 'Subdivision',
    getValue: (listing) => listing.subdivision || '',
  },
  {
    key: 'isBusinessOwner',
    label: 'Business owned',
    getValue: (listing) => (listing.isBusinessOwner ? 'Yes' : 'No'),
  },
];

const CSV_MIME_TYPE = 'text/csv';

function normaliseCell(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return value;
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = normaliseCell(value);
          const escaped = text.replace(/"/g, '""');
          return /["\n,]/.test(escaped) ? `"${escaped}"` : escaped;
        })
        .join(','),
    )
    .join('\n');
}

export function createDefaultExportColumns(): ExportColumnKey[] {
  return [...EXPORT_COLUMN_KEYS];
}

export function isExportColumnKey(value: unknown): value is ExportColumnKey {
  return (
    typeof value === 'string' &&
    (EXPORT_COLUMN_KEYS as readonly string[]).includes(value)
  );
}

export function normaliseExportColumns(columns: unknown): ExportColumnKey[] {
  if (!Array.isArray(columns)) {
    return createDefaultExportColumns();
  }

  const seen = new Set<ExportColumnKey>();
  const valid: ExportColumnKey[] = [];

  for (const value of columns) {
    if (isExportColumnKey(value) && !seen.has(value)) {
      valid.push(value);
      seen.add(value);
    }
  }

  // Add missing columns at the end
  for (const key of EXPORT_COLUMN_KEYS) {
    if (!seen.has(key)) {
      valid.push(key);
    }
  }

  return valid;
}

export function createExportRows(
  listings: ListingRecord[],
  columnKeys: ExportColumnKey[] = createDefaultExportColumns(),
): string[][] {
  const columnMap = new Map<ExportColumnKey, ExportColumnDefinition>(
    EXPORT_COLUMN_DEFINITIONS.map((def) => [def.key, def]),
  );

  const selectedColumns = columnKeys
    .map((key) => columnMap.get(key))
    .filter((def): def is ExportColumnDefinition => def !== undefined);

  const headers = selectedColumns.map((col) => col.label);
  const dataRows = listings.map((listing) =>
    selectedColumns.map((col) => col.getValue(listing)),
  );

  return [headers, ...dataRows];
}

export function createCsvBlob(
  listings: ListingRecord[],
  columnKeys?: ExportColumnKey[],
): Blob {
  const rows = createExportRows(listings, columnKeys);
  const csvContent = toCsv(rows);
  return new Blob([csvContent], { type: CSV_MIME_TYPE });
}

export function createFileBasename(date = new Date()): string {
  return `listings-export-${date.toISOString().replace(/[:.]/g, '-')}`;
}

// Legacy functions for backwards compatibility
export function createMailingListExportRows(listings: ListingRecord[]): string[][] {
  const defaultColumns = createDefaultExportColumns().slice(0, 11); // Original 11 columns
  return createExportRows(listings, defaultColumns);
}

export function createMailingListCsvBlob(listings: ListingRecord[]): Blob {
  const defaultColumns = createDefaultExportColumns().slice(0, 11); // Original 11 columns
  return createCsvBlob(listings, defaultColumns);
}

export function createMailingListFileBasename(date = new Date()): string {
  return createFileBasename(date);
}
