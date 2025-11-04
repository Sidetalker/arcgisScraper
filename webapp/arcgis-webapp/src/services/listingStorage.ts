import type { ListingAttributes, ListingRecord } from '@/types';
import { assertSupabaseClient } from '@/services/supabaseClient';

type Nullable<T> = T | null;

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
  schedule_number: Nullable<string>;
  public_detail_url: Nullable<string>;
  physical_address: Nullable<string>;
  is_business_owner: Nullable<boolean>;
  latitude: Nullable<number>;
  longitude: Nullable<number>;
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
    schedule_number: record.scheduleNumber || null,
    public_detail_url: record.publicDetailUrl || null,
    physical_address: record.physicalAddress || null,
    is_business_owner: record.isBusinessOwner,
    latitude: typeof record.latitude === 'number' ? record.latitude : null,
    longitude: typeof record.longitude === 'number' ? record.longitude : null,
    raw: (record.raw as Record<string, unknown>) ?? null,
  };
}

function fromListingRow(row: ListingRow): ListingRecord {
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
    scheduleNumber: row.schedule_number ?? '',
    publicDetailUrl: row.public_detail_url ?? '',
    physicalAddress: row.physical_address ?? '',
    isBusinessOwner: Boolean(row.is_business_owner),
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    raw: (row.raw as ListingAttributes | null) ?? {},
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
  'schedule_number',
  'public_detail_url',
  'physical_address',
  'is_business_owner',
  'latitude',
  'longitude',
  'raw',
  'updated_at',
] as const;

const PAGE_SIZE = 1000;

export async function fetchStoredListings(): Promise<StoredListingSet> {
  const client = assertSupabaseClient();
  let from = 0;
  let latest: Date | null = null;
  const records: ListingRecord[] = [];

  while (true) {
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
      break;
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
