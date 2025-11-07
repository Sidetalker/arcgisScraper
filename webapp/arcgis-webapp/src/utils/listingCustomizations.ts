import { type ListingTableColumnKey } from '@/constants/listingTable';
import type { ListingRecord, ListingSourceOfTruth } from '@/types';

const MANUAL_EDIT_COLUMN_KEYS: ListingTableColumnKey[] = [
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

function resolveSourceOfTruth(listing: ListingRecord): ListingSourceOfTruth {
  if (listing.sourceOfTruth) {
    return listing.sourceOfTruth;
  }

  return {
    complex: listing.complex,
    unit: listing.unit,
    unitNormalized: listing.unitNormalized,
    ownerName: listing.ownerName,
    ownerNames: [...listing.ownerNames],
    mailingAddress: listing.mailingAddress,
    mailingAddressLine1: listing.mailingAddressLine1,
    mailingAddressLine2: listing.mailingAddressLine2,
    mailingCity: listing.mailingCity,
    mailingState: listing.mailingState,
    mailingZip5: listing.mailingZip5,
    mailingZip9: listing.mailingZip9,
    subdivision: listing.subdivision,
    scheduleNumber: listing.scheduleNumber,
    physicalAddress: listing.physicalAddress,
    isBusinessOwner: listing.isBusinessOwner,
  };
}

function normaliseString(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normaliseMultiline(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normaliseOwners(listingOwners: string[], fallback: string): string[] {
  if (listingOwners.length > 0) {
    return listingOwners.map((owner) => owner.trim()).filter((owner) => owner.length > 0);
  }

  return fallback
    .split(/;|\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function ownersDiffer(listing: ListingRecord, source: ListingSourceOfTruth): boolean {
  const listingOwners = normaliseOwners(listing.ownerNames, listing.ownerName);
  const sourceOwners = normaliseOwners(source.ownerNames, source.ownerName);

  if (listingOwners.length !== sourceOwners.length) {
    return true;
  }

  return listingOwners.some((value, index) => value !== sourceOwners[index]);
}

function mailingAddressDiffers(listing: ListingRecord, source: ListingSourceOfTruth): boolean {
  const listingAddress = normaliseMultiline(listing.mailingAddress);
  const sourceAddress = normaliseMultiline(source.mailingAddress);
  return listingAddress !== sourceAddress;
}

function mailingZipDiffers(listing: ListingRecord, source: ListingSourceOfTruth): boolean {
  const listingZip = normaliseString(listing.mailingZip9 || listing.mailingZip5);
  const sourceZip = normaliseString(source.mailingZip9 || source.mailingZip5);
  return listingZip !== sourceZip;
}

function stringsDiffer(
  listingValue: string | null | undefined,
  sourceValue: string | null | undefined,
): boolean {
  return normaliseString(listingValue) !== normaliseString(sourceValue);
}

export function getManualEditColumnKeys(listing: ListingRecord): ListingTableColumnKey[] {
  const source = resolveSourceOfTruth(listing);
  const changed: ListingTableColumnKey[] = [];

  if (stringsDiffer(listing.complex, source.complex)) {
    changed.push('complex');
  }

  if (stringsDiffer(listing.unit, source.unit)) {
    changed.push('unit');
  }

  if (ownersDiffer(listing, source)) {
    changed.push('owners');
  }

  if (Boolean(listing.isBusinessOwner) !== Boolean(source.isBusinessOwner)) {
    changed.push('business');
  }

  if (mailingAddressDiffers(listing, source)) {
    changed.push('mailingAddress');
  }

  if (stringsDiffer(listing.mailingCity, source.mailingCity)) {
    changed.push('mailingCity');
  }

  if (stringsDiffer(listing.mailingState, source.mailingState)) {
    changed.push('mailingState');
  }

  if (mailingZipDiffers(listing, source)) {
    changed.push('mailingZip');
  }

  if (stringsDiffer(listing.subdivision, source.subdivision)) {
    changed.push('subdivision');
  }

  if (stringsDiffer(listing.scheduleNumber, source.scheduleNumber)) {
    changed.push('scheduleNumber');
  }

  if (stringsDiffer(listing.physicalAddress, source.physicalAddress)) {
    changed.push('physicalAddress');
  }

  return changed;
}

export function countManualEditColumns(listing: ListingRecord): number {
  return getManualEditColumnKeys(listing).length;
}

export function hasManualEdits(listing: ListingRecord): boolean {
  return countManualEditColumns(listing) > 0;
}

export function filterListingsByManualEdits(
  listings: ListingRecord[],
  minimumColumns: number,
): ListingRecord[] {
  const threshold = Math.max(1, Math.floor(minimumColumns));
  return listings.filter((listing) => countManualEditColumns(listing) >= threshold);
}

export const MANUAL_EDIT_KEYS = [...MANUAL_EDIT_COLUMN_KEYS];
