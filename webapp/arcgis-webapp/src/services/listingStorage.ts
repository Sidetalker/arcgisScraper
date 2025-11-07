import type {
  ListingAttributes,
  ListingRecord,
  ListingSourceOfTruth,
  RenewalCategory,
} from '@/types';
import {
  categoriseRenewal,
  normaliseMonthKey,
  parseDateValue,
  resolveRenewalCategory,
  type RenewalEstimate,
} from '@/services/renewalEstimator';
import { assertSupabaseClient } from '@/services/supabaseClient';
import { normaliseStrLicenseStatus } from '@/services/strLicenseUtils';

type Nullable<T> = T | null;
type SupabaseClientInstance = ReturnType<typeof assertSupabaseClient>;

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

function formatTimestampColumn(value: Date | null): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString();
}

function parseTimestampColumn(value: Nullable<unknown>): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export interface ListingRow {
  id: string;
  complex: Nullable<string>;
  unit: Nullable<string>;
  unit_normalized: Nullable<string>;
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
  is_favorited: Nullable<boolean>;
  latitude: Nullable<number>;
  longitude: Nullable<number>;
  estimated_renewal_date: Nullable<string>;
  estimated_renewal_method: Nullable<string>;
  estimated_renewal_reference: Nullable<string>;
  estimated_renewal_category: Nullable<string>;
  estimated_renewal_month_key: Nullable<string>;
  raw: Nullable<Record<string, unknown>>;
  str_license_id: Nullable<string>;
  str_license_status: Nullable<string>;
  str_license_status_normalized: Nullable<string>;
  str_license_updated_at: Nullable<string>;
  updated_at?: string;
}

export interface StoredListingSet {
  records: ListingRecord[];
  latestUpdatedAt: Date | null;
}

export interface ListingCustomizationOverrides {
  complex?: string;
  unit?: string;
  ownerName?: string;
  ownerNames?: string[];
  mailingAddress?: string;
  mailingAddressLine1?: string;
  mailingAddressLine2?: string;
  mailingCity?: string;
  mailingState?: string;
  mailingZip5?: string;
  mailingZip9?: string;
  subdivision?: string;
  scheduleNumber?: string;
  physicalAddress?: string;
  isBusinessOwner?: boolean;
}

interface ListingCustomizationRow {
  listing_id: string;
  overrides: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function toListingRow(record: ListingRecord): ListingRow {
  const unitNormalized = normaliseUnitString(record.unitNormalized || record.unit);
  return {
    id: record.id,
    complex: record.complex || null,
    unit: record.unit || null,
    unit_normalized: unitNormalized || null,
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
    is_favorited: record.isFavorited,
    latitude: typeof record.latitude === 'number' ? record.latitude : null,
    longitude: typeof record.longitude === 'number' ? record.longitude : null,
    estimated_renewal_date: formatDateColumn(record.estimatedRenewalDate),
    estimated_renewal_method: record.estimatedRenewalMethod ?? null,
    estimated_renewal_reference: formatDateColumn(record.estimatedRenewalReference),
    estimated_renewal_category: record.estimatedRenewalCategory ?? 'missing',
    estimated_renewal_month_key: normaliseMonthKey(record.estimatedRenewalMonthKey) ?? null,
    raw: (record.raw as Record<string, unknown>) ?? null,
    str_license_id: record.strLicenseId ?? null,
    str_license_status: record.strLicenseStatus ?? null,
    str_license_status_normalized: record.strLicenseStatusNormalized ?? 'unknown',
    str_license_updated_at: formatTimestampColumn(record.strLicenseUpdatedAt),
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

  const latitude = typeof row.latitude === 'number' ? row.latitude : null;
  const longitude = typeof row.longitude === 'number' ? row.longitude : null;

  const ownerNames = Array.isArray(row.owner_names)
    ? row.owner_names.filter((value): value is string => typeof value === 'string')
    : [];

  const strLicenseId = typeof row.str_license_id === 'string' ? row.str_license_id : null;
  const strLicenseStatus = typeof row.str_license_status === 'string' ? row.str_license_status : null;
  const strLicenseStatusNormalized = normaliseStrLicenseStatus(
    row.str_license_status_normalized ?? strLicenseStatus ?? null,
  );
  const strLicenseUpdatedAt = parseTimestampColumn(row.str_license_updated_at);

  const unitNormalized = normaliseUnitString(row.unit_normalized ?? row.unit ?? '');

  const sourceOfTruth: ListingSourceOfTruth = {
    complex: row.complex ?? '',
    unit: row.unit ?? '',
    unitNormalized,
    ownerName: row.owner_name ?? '',
    ownerNames: ownerNames.map((value) => value),
    mailingAddress: row.mailing_address ?? '',
    mailingAddressLine1: row.mailing_address_line1 ?? '',
    mailingAddressLine2: row.mailing_address_line2 ?? '',
    mailingCity: row.mailing_city ?? '',
    mailingState: row.mailing_state ?? '',
    mailingZip5: row.mailing_zip5 ?? '',
    mailingZip9: row.mailing_zip9 ?? '',
    subdivision: row.subdivision ?? '',
    scheduleNumber: row.schedule_number ?? '',
    physicalAddress: row.physical_address ?? '',
    isBusinessOwner: Boolean(row.is_business_owner),
  };

  return {
    id: row.id,
    complex: sourceOfTruth.complex,
    unit: sourceOfTruth.unit,
    unitNormalized,
    ownerName: sourceOfTruth.ownerName,
    ownerNames: [...sourceOfTruth.ownerNames],
    mailingAddress: sourceOfTruth.mailingAddress,
    mailingAddressLine1: sourceOfTruth.mailingAddressLine1,
    mailingAddressLine2: sourceOfTruth.mailingAddressLine2,
    mailingCity: sourceOfTruth.mailingCity,
    mailingState: sourceOfTruth.mailingState,
    mailingZip5: sourceOfTruth.mailingZip5,
    mailingZip9: sourceOfTruth.mailingZip9,
    subdivision: sourceOfTruth.subdivision,
    zone,
    scheduleNumber: sourceOfTruth.scheduleNumber,
    publicDetailUrl: row.public_detail_url ?? '',
    physicalAddress: sourceOfTruth.physicalAddress,
    isBusinessOwner: sourceOfTruth.isBusinessOwner,
    isFavorited: Boolean(row.is_favorited),
    hasCustomizations: false,
    latitude,
    longitude,
    estimatedRenewalDate,
    estimatedRenewalMethod,
    estimatedRenewalReference,
    estimatedRenewalCategory: safeCategory,
    estimatedRenewalMonthKey: safeMonthKey,
    strLicenseId,
    strLicenseStatus,
    strLicenseStatusNormalized,
    strLicenseUpdatedAt,
    raw: rawAttributes,
    sourceOfTruth,
  };
}

const CUSTOMIZATION_COMPARISON_KEYS: Array<keyof ListingRecord> = [
  'complex',
  'unit',
  'unitNormalized',
  'ownerName',
  'mailingAddress',
  'mailingAddressLine1',
  'mailingAddressLine2',
  'mailingCity',
  'mailingState',
  'mailingZip5',
  'mailingZip9',
  'subdivision',
  'scheduleNumber',
  'physicalAddress',
  'isBusinessOwner',
];

function normaliseStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function normaliseMultilineValue(value: unknown): string {
  if (typeof value !== 'string') {
    return normaliseStringValue(value);
  }
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normaliseOwnerNamesValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string') {
      return value
        .split(/\r?\n|;/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normaliseUnitString(value: Nullable<string>): string {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  }
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function formatCityStateZipLine(city: string, state: string, postcode: string): string {
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = postcode.trim();

  let line = '';
  if (cityPart && statePart) {
    line = `${cityPart}, ${statePart}`;
  } else if (cityPart) {
    line = cityPart;
  } else if (statePart) {
    line = statePart;
  }

  if (line && zipPart) {
    return `${line} ${zipPart}`.trim();
  }

  if (!line && zipPart) {
    return zipPart;
  }

  return line;
}

function buildMailingAddressFromParts(
  line1: string,
  line2: string,
  city: string,
  state: string,
  zip: string,
): string {
  const lines: string[] = [];
  const first = line1.trim();
  const second = line2.trim();
  const finalLine = formatCityStateZipLine(city, state, zip);

  if (first) {
    lines.push(first);
  }
  if (second) {
    lines.push(second);
  }
  if (finalLine) {
    lines.push(finalLine);
  }

  return lines.join('\n');
}

function normaliseCustomizationOverrides(
  raw: Record<string, unknown> | ListingCustomizationOverrides | null | undefined,
): ListingCustomizationOverrides {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const overrides: ListingCustomizationOverrides = {};
  if ('complex' in raw) {
    overrides.complex = normaliseStringValue((raw as Record<string, unknown>).complex);
  }
  if ('unit' in raw) {
    overrides.unit = normaliseStringValue((raw as Record<string, unknown>).unit);
  }
  if ('ownerName' in raw) {
    overrides.ownerName = normaliseStringValue((raw as Record<string, unknown>).ownerName);
  }
  if ('ownerNames' in raw) {
    overrides.ownerNames = normaliseOwnerNamesValue((raw as Record<string, unknown>).ownerNames);
  }
  if ('mailingAddress' in raw) {
    overrides.mailingAddress = normaliseMultilineValue((raw as Record<string, unknown>).mailingAddress);
  }
  if ('mailingAddressLine1' in raw) {
    overrides.mailingAddressLine1 = normaliseMultilineValue(
      (raw as Record<string, unknown>).mailingAddressLine1,
    );
  }
  if ('mailingAddressLine2' in raw) {
    overrides.mailingAddressLine2 = normaliseMultilineValue(
      (raw as Record<string, unknown>).mailingAddressLine2,
    );
  }
  if ('mailingCity' in raw) {
    overrides.mailingCity = normaliseStringValue((raw as Record<string, unknown>).mailingCity);
  }
  if ('mailingState' in raw) {
    overrides.mailingState = normaliseStringValue((raw as Record<string, unknown>).mailingState).toUpperCase();
  }
  if ('mailingZip5' in raw) {
    overrides.mailingZip5 = normaliseStringValue((raw as Record<string, unknown>).mailingZip5);
  }
  if ('mailingZip9' in raw) {
    overrides.mailingZip9 = normaliseStringValue((raw as Record<string, unknown>).mailingZip9);
  }
  if ('subdivision' in raw) {
    overrides.subdivision = normaliseStringValue((raw as Record<string, unknown>).subdivision);
  }
  if ('scheduleNumber' in raw) {
    overrides.scheduleNumber = normaliseStringValue((raw as Record<string, unknown>).scheduleNumber);
  }
  if ('physicalAddress' in raw) {
    overrides.physicalAddress = normaliseMultilineValue((raw as Record<string, unknown>).physicalAddress);
  }
  if ('isBusinessOwner' in raw) {
    const value = (raw as Record<string, unknown>).isBusinessOwner;
    overrides.isBusinessOwner = typeof value === 'boolean' ? value : Boolean(value);
  }

  return overrides;
}

function sanitiseOverridesForStorage(
  overrides: ListingCustomizationOverrides,
): ListingCustomizationOverrides {
  const entries = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as ListingCustomizationOverrides;
}

export function applyListingOverrides(
  record: ListingRecord,
  overrides: ListingCustomizationOverrides,
): ListingRecord {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { ...record };
  }

  const next: ListingRecord = {
    ...record,
    ownerNames: [...record.ownerNames],
    unitNormalized: record.unitNormalized,
  };

  let changed = false;

  type EditableStringKey =
    | 'complex'
    | 'unit'
    | 'subdivision'
    | 'scheduleNumber'
    | 'physicalAddress'
    | 'mailingCity';

  const assignString = (key: EditableStringKey, value: string | undefined) => {
    if (value === undefined) {
      return;
    }
    const safeValue = value ?? '';
    if (safeValue !== next[key]) {
      changed = true;
    }
    next[key] = safeValue;
  };

  const assignUnit = (value: string | undefined) => {
    if (value === undefined) {
      return;
    }
    const safeValue = value ?? '';
    if (safeValue !== next.unit) {
      changed = true;
    }
    next.unit = safeValue;
    const normalized = normaliseUnitString(safeValue);
    if (normalized !== next.unitNormalized) {
      changed = true;
      next.unitNormalized = normalized;
    }
  };

  assignString('complex', overrides.complex);
  assignUnit(overrides.unit);
  assignString('subdivision', overrides.subdivision);
  assignString('scheduleNumber', overrides.scheduleNumber);
  assignString('physicalAddress', overrides.physicalAddress);
  assignString('mailingCity', overrides.mailingCity);

  if (overrides.mailingState !== undefined) {
    const stateValue = (overrides.mailingState ?? '').toUpperCase();
    if (stateValue !== next.mailingState) {
      changed = true;
    }
    next.mailingState = stateValue;
  }

  if (overrides.mailingZip5 !== undefined) {
    const zip5Value = overrides.mailingZip5 ?? '';
    if (zip5Value !== next.mailingZip5) {
      changed = true;
    }
    next.mailingZip5 = zip5Value;
  }

  if (overrides.mailingZip9 !== undefined) {
    const zip9Value = overrides.mailingZip9 ?? '';
    if (zip9Value !== next.mailingZip9) {
      changed = true;
    }
    next.mailingZip9 = zip9Value;
  }

  if (overrides.mailingAddressLine1 !== undefined) {
    const line1Value = overrides.mailingAddressLine1 ?? '';
    if (line1Value !== next.mailingAddressLine1) {
      changed = true;
    }
    next.mailingAddressLine1 = line1Value;
  }

  if (overrides.mailingAddressLine2 !== undefined) {
    const line2Value = overrides.mailingAddressLine2 ?? '';
    if (line2Value !== next.mailingAddressLine2) {
      changed = true;
    }
    next.mailingAddressLine2 = line2Value;
  }

  if (overrides.ownerNames !== undefined) {
    const names = overrides.ownerNames.map((name) => name.trim()).filter(Boolean);
    if (
      names.length !== next.ownerNames.length ||
      names.some((value, index) => value !== next.ownerNames[index])
    ) {
      changed = true;
    }
    next.ownerNames = names;
    const combined =
      overrides.ownerName !== undefined
        ? overrides.ownerName
        : names.length > 0
          ? names.join('; ')
          : '';
    if (combined !== next.ownerName) {
      changed = true;
    }
    next.ownerName = combined;
  } else if (overrides.ownerName !== undefined) {
    const combined = overrides.ownerName ?? '';
    if (combined !== next.ownerName) {
      changed = true;
    }
    next.ownerName = combined;
    const names = combined
      ? combined
          .split(/;|\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    if (
      names.length !== next.ownerNames.length ||
      names.some((value, index) => value !== next.ownerNames[index])
    ) {
      changed = true;
    }
    next.ownerNames = names;
  }

  if (overrides.mailingAddress !== undefined) {
    const addressValue = overrides.mailingAddress ?? '';
    if (addressValue !== next.mailingAddress) {
      changed = true;
    }
    next.mailingAddress = addressValue;
  }

  if (overrides.isBusinessOwner !== undefined) {
    const booleanValue = Boolean(overrides.isBusinessOwner);
    if (booleanValue !== next.isBusinessOwner) {
      changed = true;
    }
    next.isBusinessOwner = booleanValue;
  }

  if (overrides.mailingAddress === undefined) {
    const rebuilt = buildMailingAddressFromParts(
      next.mailingAddressLine1,
      next.mailingAddressLine2,
      next.mailingCity,
      next.mailingState,
      next.mailingZip9 || next.mailingZip5,
    );
    if (rebuilt !== next.mailingAddress) {
      changed = true;
      next.mailingAddress = rebuilt;
    }
  }

  return {
    ...next,
    hasCustomizations: changed ? true : record.hasCustomizations,
  };
}

function listingsDiffer(base: ListingRecord, next: ListingRecord): boolean {
  if (
    base.ownerNames.length !== next.ownerNames.length ||
    base.ownerNames.some((value, index) => value !== next.ownerNames[index])
  ) {
    return true;
  }

  return CUSTOMIZATION_COMPARISON_KEYS.some((key) => base[key] !== next[key]);
}

const LISTING_COLUMNS = [
  'id',
  'complex',
  'unit',
  'unit_normalized',
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
  'is_favorited',
  'latitude',
  'longitude',
  'estimated_renewal_date',
  'estimated_renewal_method',
  'estimated_renewal_reference',
  'estimated_renewal_category',
  'estimated_renewal_month_key',
  'raw',
  'str_license_id',
  'str_license_status',
  'str_license_status_normalized',
  'str_license_updated_at',
  'updated_at',
] as const;

async function fetchListingRowById(
  client: SupabaseClientInstance,
  listingId: string,
): Promise<ListingRow> {
  const { data, error } = await client
    .from('listings')
    .select(LISTING_COLUMNS.join(', '))
    .eq('id', listingId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Listing not found.');
  }

  return data as unknown as ListingRow;
}

async function fetchListingCustomizations(
  client: SupabaseClientInstance,
): Promise<Map<string, { overrides: ListingCustomizationOverrides; updatedAt: Date | null }>> {
  const { data, error } = await client
    .from('listing_customizations')
    .select('listing_id, overrides, updated_at');

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as unknown as ListingCustomizationRow[];
  const map = new Map<string, { overrides: ListingCustomizationOverrides; updatedAt: Date | null }>();

  rows.forEach((row) => {
    const overrides = normaliseCustomizationOverrides(row.overrides);
    const updatedAtRaw = row.updated_at ? new Date(row.updated_at) : null;
    const updatedAt = updatedAtRaw && !Number.isNaN(updatedAtRaw.getTime()) ? updatedAtRaw : null;

    if (Object.keys(overrides).length === 0) {
      return;
    }

    map.set(row.listing_id, { overrides, updatedAt });
  });

  return map;
}

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

  const customisations = await fetchListingCustomizations(client);

  const mergedRecords = records.map((record) => {
    const entry = customisations.get(record.id);
    if (!entry) {
      return { ...record, hasCustomizations: false };
    }

    if (entry.updatedAt) {
      latest = latest && latest > entry.updatedAt ? latest : entry.updatedAt;
    }

    const merged = applyListingOverrides({ ...record, hasCustomizations: false }, entry.overrides);
    const hasDifferences = listingsDiffer(record, merged);
    return { ...merged, hasCustomizations: hasDifferences };
  });

  return { records: mergedRecords, latestUpdatedAt: latest };
}

export async function replaceAllListings(records: ListingRecord[]): Promise<void> {
  const client = assertSupabaseClient();
  const rows = records.map((record) => toListingRow(record));

  const { data: existingRows, error: fetchError } = await client.from('listings').select('id');
  if (fetchError) {
    throw fetchError;
  }

  const incomingIds = new Set(rows.map((row) => row.id));
  const existingIds = new Set(
    (existingRows ?? [])
      .map((row) => (typeof row?.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id)),
  );

  const idsToDelete: string[] = [];
  existingIds.forEach((id) => {
    if (!incomingIds.has(id)) {
      idsToDelete.push(id);
    }
  });

  if (idsToDelete.length > 0) {
    const { error: deleteMissingError } = await client
      .from('listings')
      .delete()
      .in('id', idsToDelete);
    if (deleteMissingError) {
      throw deleteMissingError;
    }
  }

  const chunkSize = 400;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const { error: upsertError } = await client
      .from('listings')
      .upsert(chunk, { onConflict: 'id' });
    if (upsertError) {
      throw upsertError;
    }
  }
}

export async function updateListingFavorite(
  listingId: string,
  isFavorited: boolean,
): Promise<{ record: ListingRecord; updatedAt: Date | null }> {
  const client = assertSupabaseClient();
  const { data, error } = await client
    .from('listings')
    .update({ is_favorited: isFavorited })
    .eq('id', listingId)
    .select(LISTING_COLUMNS.join(', '))
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Listing not found while updating favorite state.');
  }

  const row = data as unknown as ListingRow;
  const record = fromListingRow(row);
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const safeUpdatedAt = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null;
  return { record, updatedAt: safeUpdatedAt };
}

export async function upsertListingCustomization(
  listingId: string,
  overrides: ListingCustomizationOverrides,
): Promise<{ record: ListingRecord; updatedAt: Date | null }> {
  const client = assertSupabaseClient();
  const baseRow = await fetchListingRowById(client, listingId);
  const baseRecord = fromListingRow(baseRow);
  const sanitisedOverrides = sanitiseOverridesForStorage(overrides);
  const mergedRecord = applyListingOverrides(baseRecord, sanitisedOverrides);
  const hasDifferences = listingsDiffer(baseRecord, mergedRecord);

  if (!hasDifferences) {
    const { error: deleteError } = await client
      .from('listing_customizations')
      .delete()
      .eq('listing_id', listingId);
    if (deleteError) {
      throw deleteError;
    }
    return { record: { ...baseRecord, hasCustomizations: false }, updatedAt: new Date() };
  }

  const payload = {
    listing_id: listingId,
    overrides: sanitisedOverrides,
  };

  const { data, error } = await client
    .from('listing_customizations')
    .upsert(payload, { onConflict: 'listing_id' })
    .select('listing_id, overrides, updated_at')
    .single();

  if (error) {
    throw error;
  }

  const updatedAtRaw = data?.updated_at ? new Date(data.updated_at) : new Date();
  const updatedAt = !Number.isNaN(updatedAtRaw.getTime()) ? updatedAtRaw : new Date();

  const storedOverrides = normaliseCustomizationOverrides(
    (data?.overrides as Record<string, unknown> | null) ?? sanitisedOverrides,
  );
  const storedRecord = applyListingOverrides(baseRecord, storedOverrides);
  return { record: { ...storedRecord, hasCustomizations: true }, updatedAt };
}

export async function removeListingCustomization(
  listingId: string,
): Promise<{ record: ListingRecord; updatedAt: Date | null }> {
  const client = assertSupabaseClient();
  const baseRow = await fetchListingRowById(client, listingId);
  const { error } = await client.from('listing_customizations').delete().eq('listing_id', listingId);

  if (error) {
    throw error;
  }

  const baseRecord = fromListingRow(baseRow);
  return { record: { ...baseRecord, hasCustomizations: false }, updatedAt: new Date() };
}
