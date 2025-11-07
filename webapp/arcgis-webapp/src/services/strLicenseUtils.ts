import type { ArcgisFeature, ArcgisFeatureSet, ListingRecord, StrLicenseStatus } from '@/types';
import statusMappings from '../../shared/strLicenseStatus.json' assert { type: 'json' };

export const STR_LICENSE_LAYER_URL =
  'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';
export const STR_LICENSE_SCHEDULE_FIELD = 'HC_RegistrationsOriginalCleaned';
export const STR_LICENSE_ID_FIELD = 'HC_RegistrationsOriginalClean_1';
export const STR_LICENSE_STATUS_FIELD = 'HC_RegistrationsOriginalClea_43';
export const STR_LICENSE_UPDATED_AT_FIELD = 'EditDate';

interface RawStatusMapping {
  match?: string;
  status?: StrLicenseStatus;
}

interface NormalisedStatusMapping {
  match: string;
  status: StrLicenseStatus;
}

const STATUS_MAPPINGS: NormalisedStatusMapping[] = (statusMappings as RawStatusMapping[])
  .map((entry) => ({
    match: typeof entry.match === 'string' ? entry.match.toUpperCase() : '',
    status: (entry.status as StrLicenseStatus | undefined) ?? 'unknown',
  }))
  .filter((entry) => entry.match.length > 0);

export interface StrLicenseAttributes extends Record<string, unknown> {
  [STR_LICENSE_SCHEDULE_FIELD]?: string | number | null;
  [STR_LICENSE_ID_FIELD]?: string | null;
  [STR_LICENSE_STATUS_FIELD]?: string | null;
  [STR_LICENSE_UPDATED_AT_FIELD]?: number | string | null;
}

export interface StrLicenseRecord {
  rosterKey: string;
  licenseId: string | null;
  status: string | null;
  normalizedStatus: StrLicenseStatus;
  updatedAt: Date | null;
  raw: Record<string, unknown>;
}

export function formatStrLicenseKey(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString().trim().toUpperCase() || null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : null;
  }

  return null;
}

export function normaliseStrLicenseStatus(value: unknown): StrLicenseStatus {
  if (value === null || value === undefined) {
    return 'unknown';
  }

  const text = String(value).trim();
  if (!text) {
    return 'unknown';
  }

  const upper = text.toUpperCase();
  for (const mapping of STATUS_MAPPINGS) {
    if (upper.includes(mapping.match)) {
      return mapping.status;
    }
  }

  return 'unknown';
}

export function parseStrLicenseUpdatedAt(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromEpoch = new Date(value);
    if (!Number.isNaN(fromEpoch.getTime())) {
      return fromEpoch;
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function toStrLicenseRecord(attributes: StrLicenseAttributes): StrLicenseRecord | null {
  const rosterKey = formatStrLicenseKey(attributes[STR_LICENSE_SCHEDULE_FIELD]);
  if (!rosterKey) {
    return null;
  }

  const licenseIdRaw = attributes[STR_LICENSE_ID_FIELD];
  const statusRaw = attributes[STR_LICENSE_STATUS_FIELD];
  const updatedAtRaw =
    attributes[STR_LICENSE_UPDATED_AT_FIELD] ??
    (attributes.EditDate as unknown) ??
    (attributes.editDate as unknown);

  const licenseId =
    typeof licenseIdRaw === 'string' && licenseIdRaw.trim().length > 0
      ? licenseIdRaw.trim()
      : null;
  const status =
    typeof statusRaw === 'string' && statusRaw.trim().length > 0 ? statusRaw.trim() : null;
  const normalizedStatus = normaliseStrLicenseStatus(statusRaw);
  const updatedAt = parseStrLicenseUpdatedAt(updatedAtRaw);

  return {
    rosterKey,
    licenseId,
    status,
    normalizedStatus,
    updatedAt,
    raw: { ...attributes },
  };
}

function resolveRosterKeyFromListing(listing: ListingRecord): string | null {
  const rawAttributes = (listing.raw as Record<string, unknown>) ?? {};
  const rawKey =
    rawAttributes[STR_LICENSE_SCHEDULE_FIELD] ??
    listing.scheduleNumber ??
    listing.sourceOfTruth?.scheduleNumber ??
    listing.id;

  return formatStrLicenseKey(rawKey);
}

export function enrichListingsWithLicenseData(
  listings: ListingRecord[],
  roster: ArcgisFeatureSet<StrLicenseAttributes>,
): ListingRecord[] {
  const index = new Map<string, StrLicenseRecord>();
  const features = roster.features ?? [];

  features.forEach((feature: ArcgisFeature<StrLicenseAttributes>) => {
    const record = toStrLicenseRecord(feature.attributes ?? {});
    if (!record) {
      return;
    }
    if (!index.has(record.rosterKey)) {
      index.set(record.rosterKey, record);
    }
  });

  return listings.map((listing) => {
    const rosterKey = resolveRosterKeyFromListing(listing);
    if (!rosterKey) {
      return {
        ...listing,
        strLicenseId: null,
        strLicenseStatus: null,
        strLicenseStatusNormalized: 'unknown',
        strLicenseUpdatedAt: null,
      };
    }

    const match = index.get(rosterKey);
    if (!match) {
      return {
        ...listing,
        strLicenseId: null,
        strLicenseStatus: null,
        strLicenseStatusNormalized: 'unknown',
        strLicenseUpdatedAt: null,
      };
    }

    return {
      ...listing,
      strLicenseId: match.licenseId,
      strLicenseStatus: match.status,
      strLicenseStatusNormalized: match.normalizedStatus,
      strLicenseUpdatedAt: match.updatedAt,
    };
  });
}
