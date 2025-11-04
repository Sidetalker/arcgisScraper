import { del, get, set } from 'idb-keyval';

import type { ListingRecord } from '@/types';

const LISTINGS_CACHE_KEY = 'arcgis:listings-cache:v1';

type CachedListingRecord = Omit<ListingRecord, 'raw'>;

type ListingCachePayload = {
  records: CachedListingRecord[];
  savedAt: string;
  supabaseUpdatedAt: string | null;
};

export async function saveListingsToCache(
  records: ListingRecord[],
  supabaseUpdatedAt: Date | null,
): Promise<Date> {
  const savedAt = new Date();
  const payload: ListingCachePayload = {
    records: records.map(({ raw: _raw, ...rest }) => rest),
    savedAt: savedAt.toISOString(),
    supabaseUpdatedAt: supabaseUpdatedAt ? supabaseUpdatedAt.toISOString() : null,
  };

  await set(LISTINGS_CACHE_KEY, payload);
  return savedAt;
}

export async function loadListingsFromCache(): Promise<
  | {
      records: ListingRecord[];
      savedAt: Date;
      supabaseUpdatedAt: Date | null;
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
    townName: record.townName ?? '',
    zoneName: record.zoneName ?? '',
    zoningType: record.zoningType ?? '',
    briefPropertyDescription: record.briefPropertyDescription ?? '',
    situsAddressTypeDescription: record.situsAddressTypeDescription ?? '',
    raw: {},
  }));

  return {
    records,
    savedAt,
    supabaseUpdatedAt: normalisedSupabaseDate,
  };
}

export async function clearListingsCache(): Promise<void> {
  await del(LISTINGS_CACHE_KEY);
}
