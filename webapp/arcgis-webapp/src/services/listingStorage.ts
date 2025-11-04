import type { ListingAttributes, ListingRecord, RenewalCategory } from '@/types';
import {
  categoriseRenewal,
  normaliseMonthKey,
  parseDateValue,
  resolveRenewalCategory,
  type RenewalEstimate,
} from '@/services/renewalEstimator';
import { assertSupabaseClient } from '@/services/supabaseClient';

type Nullable<T> = T | null;

const RENEWAL_METHODS: ReadonlySet<RenewalEstimate['method']> = new Set([
  'direct_permit',
  'transfer_cycle',
  'assessment_cycle',
  'update_cycle',
  'generic_cycle',
]);

const RENEWAL_CATEGORIES: ReadonlySet<RenewalCategory> = new Set([
  'overdue',
  'due_30',
  'due_60',
  'due_90',
  'future',
  'missing',
]);

function normaliseRenewalMethod(value: Nullable<string>): RenewalEstimate['method'] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return RENEWAL_METHODS.has(trimmed as RenewalEstimate['method'])
    ? (trimmed as RenewalEstimate['method'])
    : null;
}

function normaliseRenewalCategory(value: Nullable<string>): RenewalCategory | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return RENEWAL_CATEGORIES.has(trimmed as RenewalCategory)
    ? (trimmed as RenewalCategory)
    : null;
}

function parseDateColumn(value: Nullable<unknown>): Date | null {
  return parseDateValue(value ?? null);
}

function formatDateColumn(value: Date | null): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

export interface ListingRow {
  id: string;
  complex: Nullable<string>;
  unit: Nullable<string>;
  owner_name: Nullable<string>;
  owner_names: Nullable<string[]>;
  mailing_address: Nullable<string>;
  mailing_address_line1: Nullable<string>;
  mailing_address_line2: Nullable<string>;
  mailing_city: Nullable<string>;
  mailing_state: Nullable<string>;
  mailing_zip5: Nullable<string>;
  mailing_zip9: Nullable<string>;
  subdivision: Nullable<string>;
  zone: Nullable<string>;
  schedule_number: Nullable<string>;
  public_detail_url: Nullable<string>;
  physical_address: Nullable<string>;
  is_business_owner: Nullable<boolean>;
  latitude: Nullable<number>;
  longitude: Nullable<number>;
  estimated_renewal_date: Nullable<string>;
  estimated_renewal_method: Nullable<string>;
  estimated_renewal_reference: Nullable<string>;
  estimated_renewal_category: Nullable<string>;
  estimated_renewal_month_key: Nullable<string>;
  nearest_ev_station_distance_meters: Nullable<number>;
  raw: Nullable<Record<string, unknown>>;
  updated_at?: string;
}

export interface StoredListingSet {
  records: ListingRecord[];
  latestUpdatedAt: Date | null;
}

function toListingRow(record: ListingRecord): ListingRow {
  return {
    id: record.id,
    complex: record.complex || null,
    unit: record.unit || null,
    owner_name: record.ownerName || null,
    owner_names: record.ownerNames.length ? record.ownerNames : null,
    mailing_address: record.mailingAddress || null,
    mailing_address_line1: record.mailingAddressLine1 || null,
    mailing_address_line2: record.mailingAddressLine2 || null,
    mailing_city: record.mailingCity || null,
    mailing_state: record.mailingState || null,
    mailing_zip5: record.mailingZip5 || null,
    mailing_zip9: record.mailingZip9 || null,
    subdivision: record.subdivision || null,
    zone: record.zone || null,
    schedule_number: record.scheduleNumber || null,
    public_detail_url: record.publicDetailUrl || null,
    physical_address: record.physicalAddress || null,
    is_business_owner: record.isBusinessOwner,
    latitude: typeof record.latitude === 'number' ? record.latitude : null,
    longitude: typeof record.longitude === 'number' ? record.longitude : null,
    estimated_renewal_date: formatDateColumn(record.estimatedRenewalDate),
    estimated_renewal_method: record.estimatedRenewalMethod ?? null,
    estimated_renewal_reference: formatDateColumn(record.estimatedRenewalReference),
    estimated_renewal_category: record.estimatedRenewalCategory ?? 'missing',
    estimated_renewal_month_key: normaliseMonthKey(record.estimatedRenewalMonthKey) ?? null,
    nearest_ev_station_distance_meters:
      typeof record.nearestEvStationDistanceMeters === 'number'
        ? record.nearestEvStationDistanceMeters
        : null,
    raw: (record.raw as Record<string, unknown>) ?? null,
  };
}

function fromListingRow(row: ListingRow): ListingRecord {
  const rawAttributes = (row.raw as ListingAttributes | null) ?? {};
  const referenceDate = new Date();

  let estimatedRenewalDate = parseDateColumn(row.estimated_renewal_date);
  let estimatedRenewalMethod = normaliseRenewalMethod(row.estimated_renewal_method);
  let estimatedRenewalReference = parseDateColumn(row.estimated_renewal_reference);
  let estimatedRenewalCategory = normaliseRenewalCategory(row.estimated_renewal_category);
  let estimatedRenewalMonthKey = normaliseMonthKey(row.estimated_renewal_month_key);

  if (estimatedRenewalDate) {
    const estimate: RenewalEstimate = {
      date: estimatedRenewalDate,
      method: estimatedRenewalMethod ?? 'generic_cycle',
      reference: estimatedRenewalReference ?? null,
    };
    const snapshot = resolveRenewalCategory(estimate, referenceDate);
    estimatedRenewalDate = snapshot.estimate?.date ?? estimatedRenewalDate;
    estimatedRenewalMethod = snapshot.estimate?.method ?? estimatedRenewalMethod ?? null;
    estimatedRenewalReference = snapshot.estimate?.reference ?? estimatedRenewalReference ?? null;
    estimatedRenewalCategory = estimatedRenewalCategory ?? snapshot.category;
    estimatedRenewalMonthKey = estimatedRenewalMonthKey ?? snapshot.monthKey;
  } else {
    const snapshot = categoriseRenewal(rawAttributes, referenceDate);
    estimatedRenewalDate = snapshot.estimate?.date ?? null;
    estimatedRenewalMethod = snapshot.estimate?.method ?? null;
    estimatedRenewalReference = snapshot.estimate?.reference ?? null;
    estimatedRenewalCategory = snapshot.category;
    estimatedRenewalMonthKey = snapshot.monthKey;
  }

  const safeCategory = estimatedRenewalCategory ?? 'missing';
  const safeMonthKey = normaliseMonthKey(estimatedRenewalMonthKey) ?? null;

  const zone = typeof row.zone === 'string' ? row.zone.trim() : '';

  return {
    id: row.id,
    complex: row.complex ?? '',
    unit: row.unit ?? '',
    ownerName: row.owner_name ?? '',
    ownerNames: row.owner_names ?? [],
    mailingAddress: row.mailing_address ?? '',
    mailingAddressLine1: row.mailing_address_line1 ?? '',
    mailingAddressLine2: row.mailing_address_line2 ?? '',
    mailingCity: row.mailing_city ?? '',
    mailingState: row.mailing_state ?? '',
    mailingZip5: row.mailing_zip5 ?? '',
    mailingZip9: row.mailing_zip9 ?? '',
    subdivision: row.subdivision ?? '',
    zone,
    scheduleNumber: row.schedule_number ?? '',
    publicDetailUrl: row.public_detail_url ?? '',
    physicalAddress: row.physical_address ?? '',
    isBusinessOwner: Boolean(row.is_business_owner),
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    estimatedRenewalDate,
    estimatedRenewalMethod,
    estimatedRenewalReference,
    estimatedRenewalCategory: safeCategory,
    estimatedRenewalMonthKey: safeMonthKey,
    nearestEvStationDistanceMeters: typeof row.nearest_ev_station_distance_meters === 'number' ? row.nearest_ev_station_distance_meters : null,
    raw: rawAttributes,
  };
}

const LISTING_COLUMNS = [
  'id',
  'complex',
  'unit',
  'owner_name',
  'owner_names',
  'mailing_address',
  'mailing_address_line1',
  'mailing_address_line2',
  'mailing_city',
  'mailing_state',
  'mailing_zip5',
  'mailing_zip9',
  'subdivision',
  'zone',
  'schedule_number',
  'public_detail_url',
  'physical_address',
  'is_business_owner',
  'latitude',
  'longitude',
  'estimated_renewal_date',
  'estimated_renewal_method',
  'estimated_renewal_reference',
  'estimated_renewal_category',
  'estimated_renewal_month_key',
  'nearest_ev_station_distance_meters',
  'raw',
  'updated_at',
] as const;

const PAGE_SIZE = 1000;

export async function fetchStoredListings(): Promise<StoredListingSet> {
  const client = assertSupabaseClient();
  let from = 0;
  let latest: Date | null = null;
  const records: ListingRecord[] = [];

  let hasMore = true;
  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from('listings')
      .select(LISTING_COLUMNS.join(', '))
      .order('schedule_number', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as unknown as ListingRow[];
    rows.forEach((row) => {
      if (row.updated_at) {
        const timestamp = new Date(row.updated_at);
        if (!Number.isNaN(timestamp.getTime())) {
          latest = latest && latest > timestamp ? latest : timestamp;
        }
      }
      records.push(fromListingRow(row));
    });

    if (rows.length < PAGE_SIZE) {
      hasMore = false;
      continue;
    }

    from += PAGE_SIZE;
  }

  return { records, latestUpdatedAt: latest };
}

export async function replaceAllListings(records: ListingRecord[]): Promise<void> {
  const client = assertSupabaseClient();
  const rows = records.map((record) => toListingRow(record));

  const { error: deleteError } = await client.from('listings').delete().neq('id', '');
  if (deleteError) {
    throw deleteError;
  }

  const chunkSize = 400;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const { error: insertError } = await client.from('listings').insert(chunk);
    if (insertError) {
      throw insertError;
    }
  }
}
