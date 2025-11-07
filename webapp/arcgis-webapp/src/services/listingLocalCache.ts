import { del, get, set } from 'idb-keyval';

import type { ListingRecord } from '@/types';
import type { OwnerBlacklistEntry } from '@/services/listingStorage';

const LISTINGS_CACHE_KEY = 'arcgis:listings-cache:v1';

type CachedListingRecord = Omit<ListingRecord, 'raw'>;

type CachedOwnerBlacklistEntry = Omit<OwnerBlacklistEntry, 'createdAt' | 'updatedAt'> & {
  createdAt: string | null;
  updatedAt: string | null;
};

type ListingCachePayload = {
  records: CachedListingRecord[];
  savedAt: string;
  supabaseUpdatedAt: string | null;
  owners?: CachedOwnerBlacklistEntry[];
};

export async function saveListingsToCache(
  records: ListingRecord[],
  supabaseUpdatedAt: Date | null,
  owners: OwnerBlacklistEntry[],
): Promise<Date> {
  const savedAt = new Date();
  const payload: ListingCachePayload = {
    records: records.map(({ raw: _raw, ...rest }) => rest),
    savedAt: savedAt.toISOString(),
    supabaseUpdatedAt: supabaseUpdatedAt ? supabaseUpdatedAt.toISOString() : null,
    owners: owners.map((owner) => ({
      ...owner,
      createdAt: owner.createdAt ? owner.createdAt.toISOString() : null,
      updatedAt: owner.updatedAt ? owner.updatedAt.toISOString() : null,
    })),
  };

  await set(LISTINGS_CACHE_KEY, payload);
  return savedAt;
}

export async function loadListingsFromCache(): Promise<
  | {
      records: ListingRecord[];
      savedAt: Date;
      supabaseUpdatedAt: Date | null;
      owners: OwnerBlacklistEntry[];
    }
  | null
> {
  const payload = (await get<ListingCachePayload | undefined>(LISTINGS_CACHE_KEY)) ?? null;
  if (!payload) {
    return null;
  }

  const savedAt = new Date(payload.savedAt);
  if (Number.isNaN(savedAt.getTime())) {
    await del(LISTINGS_CACHE_KEY);
    return null;
  }

  const supabaseUpdatedAt = payload.supabaseUpdatedAt
    ? new Date(payload.supabaseUpdatedAt)
    : null;

  const normalisedSupabaseDate =
    supabaseUpdatedAt && !Number.isNaN(supabaseUpdatedAt.getTime())
      ? supabaseUpdatedAt
      : null;

  const records: ListingRecord[] = (payload.records ?? []).map((record) => ({
    ...record,
    zone: typeof record.zone === 'string' ? record.zone : '',
    hasCustomizations: Boolean(record.hasCustomizations),
    isOwnerBlacklisted: Boolean(record.isOwnerBlacklisted),
    strLicenseId: record.strLicenseId ?? null,
    strLicenseStatus: record.strLicenseStatus ?? null,
    strLicenseStatusNormalized: record.strLicenseStatusNormalized ?? 'unknown',
    strLicenseUpdatedAt: (() => {
      const value = record.strLicenseUpdatedAt;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      return null;
    })(),
    raw: {},
    sourceOfTruth: record.sourceOfTruth ?? null,
  }));

  const owners: OwnerBlacklistEntry[] = (payload.owners ?? [])
    .map((owner) => {
      const createdAt = owner.createdAt ? new Date(owner.createdAt) : null;
      const updatedAt = owner.updatedAt ? new Date(owner.updatedAt) : null;
      return {
        ownerName: owner.ownerName,
        ownerNameNormalized: owner.ownerNameNormalized,
        createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
        updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
      } satisfies OwnerBlacklistEntry;
    })
    .filter((owner) => owner.ownerNameNormalized.length > 0);

  return {
    records,
    savedAt,
    supabaseUpdatedAt: normalisedSupabaseDate,
    owners,
  };
}

export async function clearListingsCache(): Promise<void> {
  await del(LISTINGS_CACHE_KEY);
}
