import type { ListingRecord } from '@/types';

const MAILING_LIST_HEADERS = [
  'Owner name',
  'Mailing address line 1',
  'Mailing address line 2',
  'Mailing city',
  'Mailing state',
  'Mailing ZIP',
  'Complex',
  'Unit',
  'Schedule number',
  'Physical address',
  'Business owned',
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

function listingToRow(listing: ListingRecord): string[] {
  return [
    normaliseCell(listing.ownerName),
    normaliseCell(listing.mailingAddressLine1),
    normaliseCell(listing.mailingAddressLine2),
    normaliseCell(listing.mailingCity),
    normaliseCell(listing.mailingState),
    normaliseCell(listing.mailingZip9 || listing.mailingZip5),
    normaliseCell(listing.complex),
    normaliseCell(listing.unit),
    normaliseCell(listing.scheduleNumber),
    normaliseCell(listing.physicalAddress),
    listing.isBusinessOwner ? 'Yes' : 'No',
  ];
}

export function createMailingListExportRows(listings: ListingRecord[]): string[][] {
  return [MAILING_LIST_HEADERS, ...listings.map((listing) => listingToRow(listing))];
}

export function createMailingListCsvBlob(listings: ListingRecord[]): Blob {
  const rows = createMailingListExportRows(listings);
  const csvContent = toCsv(rows);
  return new Blob([csvContent], { type: CSV_MIME_TYPE });
}

export function createMailingListFileBasename(date = new Date()): string {
  return `mailing-list-${date.toISOString().replace(/[:.]/g, '-')}`;
}
