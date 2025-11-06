import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const STATUS_ALIASES = new Map([
  ['APPROVED', 'active'],
  ['ACTIVE', 'active'],
  ['ISSUED', 'active'],
  ['CURRENT', 'active'],
  ['GOOD STANDING', 'active'],
  ['IN GOOD STANDING', 'active'],
  ['RENEWED', 'active'],
  ['PAID', 'active'],
  ['PENDING', 'pending'],
  ['UNDER REVIEW', 'pending'],
  ['IN PROCESS', 'pending'],
  ['EXPIRED', 'expired'],
  ['INACTIVE', 'inactive'],
  ['SUSPENDED', 'inactive'],
  ['REVOKED', 'revoked'],
  ['DENIED', 'revoked'],
  ['CANCELLED', 'revoked'],
  ['CANCELED', 'revoked'],
]);

const DEFAULT_REFERER =
  process.env.SUMMIT_ARCGIS_REFERER ??
  process.env.SUMMIT_MUNICIPAL_REFERER ??
  'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/';

const STATUS_USER_AGENT = 'arcgis-webapp-metrics/1.0';

function buildArcgisHeaders() {
  return {
    Referer: DEFAULT_REFERER,
    'User-Agent': STATUS_USER_AGENT,
  };
}

const DEFAULT_SOURCES = [
  {
    key: 'breckenridge',
    municipality: 'Breckenridge',
    layerUrl:
      process.env.BRECKENRIDGE_ROSTER_URL ??
      'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0',
    scheduleField: process.env.BRECKENRIDGE_SCHEDULE_FIELD ?? 'HC_RegistrationsOriginalCleaned',
    licenseIdField: process.env.BRECKENRIDGE_LICENSE_FIELD ?? 'HC_RegistrationsOriginalClean_1',
    statusField: process.env.BRECKENRIDGE_STATUS_FIELD ?? 'HC_RegistrationsOriginalClea_43',
    expirationField: process.env.BRECKENRIDGE_EXPIRATION_FIELD ?? null,
    updatedField: process.env.BRECKENRIDGE_UPDATED_FIELD ?? null,
    where: '1=1',
    outFields: ['*'],
    detailUrlTemplate:
      process.env.BRECKENRIDGE_LICENSE_URL_TEMPLATE ??
      'https://www.townofbreckenridge.com/str/{HC_RegistrationsOriginalClean_1}',
  },
  {
    key: 'unincorporated_summit_county',
    municipality: 'Unincorporated Summit County',
    layerUrl:
      process.env.UNINCORPORATED_SUMMIT_COUNTY_ROSTER_URL ??
      'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0',
    scheduleField:
      process.env.UNINCORPORATED_SUMMIT_COUNTY_SCHEDULE_FIELD ?? 'HC_RegistrationsOriginalCleaned',
    licenseIdField:
      process.env.UNINCORPORATED_SUMMIT_COUNTY_LICENSE_FIELD ?? 'HC_RegistrationsOriginalClean_1',
    statusField:
      process.env.UNINCORPORATED_SUMMIT_COUNTY_STATUS_FIELD ?? 'HC_RegistrationsOriginalClea_43',
    expirationField: process.env.UNINCORPORATED_SUMMIT_COUNTY_EXPIRATION_FIELD ?? null,
    updatedField: process.env.UNINCORPORATED_SUMMIT_COUNTY_UPDATED_FIELD ?? null,
    where: '1=1',
    outFields: ['*'],
  },
];

function readJsonFile(filePath) {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return null;
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function loadSourceOverrides() {
  const overridesPath = process.env.SUMMIT_MUNICIPAL_ROSTERS;
  if (!overridesPath) {
    return [];
  }
  const payload = readJsonFile(overridesPath);
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => ({
      key: String(entry.municipality ?? '').toLowerCase(),
      municipality: entry.municipality,
      layerUrl: entry.layer_url,
      scheduleField: entry.schedule_field,
      licenseIdField: entry.license_id_field,
      statusField: entry.status_field,
      expirationField: entry.expiration_field ?? null,
      updatedField: entry.updated_field ?? null,
      where: entry.where ?? '1=1',
      outFields: Array.isArray(entry.out_fields) && entry.out_fields.length > 0 ? entry.out_fields : ['*'],
      detailUrlTemplate: entry.detail_url_template ?? null,
    }))
    .filter((entry) =>
      Boolean(entry.key && entry.municipality && entry.layerUrl && entry.scheduleField && entry.licenseIdField && entry.statusField),
    );
}

function loadMunicipalSources() {
  const overrides = loadSourceOverrides();
  const sources = new Map();
  for (const source of DEFAULT_SOURCES) {
    if (source.layerUrl) {
      sources.set(source.key, { ...source });
    }
  }
  for (const override of overrides) {
    sources.set(override.key, override);
  }
  return Array.from(sources.values());
}

function normaliseScheduleNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  return text.toUpperCase();
}

function normaliseStatus(value) {
  if (value === null || value === undefined) {
    return 'unknown';
  }
  const text = String(value).trim();
  if (!text) {
    return 'unknown';
  }
  const upper = text.toUpperCase();
  for (const [key, alias] of STATUS_ALIASES.entries()) {
    if (upper.includes(key)) {
      return alias;
    }
  }
  return 'unknown';
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    if (value > 1e9) {
      const date = new Date(value * 1000);
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const isoCandidate = new Date(trimmed);
    if (!Number.isNaN(isoCandidate.getTime())) {
      return isoCandidate.toISOString().slice(0, 10);
    }

    const mmddyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mmddyyyy) {
      const [_, month, day, year] = mmddyyyy;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    const ymdHms = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    if (ymdHms) {
      const [_, datePart, timePart] = ymdHms;
      const date = new Date(`${datePart}T${timePart}Z`);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

function buildDetailUrl(template, attributes) {
  if (!template) {
    return null;
  }
  try {
    return template.replace(/\{([^{}]+)\}/g, (_, key) => {
      const value = attributes?.[key];
      return value === null || value === undefined ? '' : String(value);
    });
  } catch (error) {
    return null;
  }
}

function buildRecordId(municipality, licenseId) {
  const key = `${municipality}::${licenseId}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function fetchFeaturePage(source, offset, limit) {
  const params = new URLSearchParams({
    f: 'json',
    where: source.where ?? '1=1',
    outFields: Array.isArray(source.outFields) && source.outFields.length > 0 ? source.outFields.join(',') : '*',
    returnGeometry: 'false',
    resultOffset: String(offset),
    resultRecordCount: String(limit),
  });

  const url = `${source.layerUrl.replace(/\/?$/, '')}/query?${params.toString()}`;
  const response = await fetch(url, { headers: buildArcgisHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch municipal roster ${source.municipality}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    const message = payload.error.message ?? 'Unknown ArcGIS error';
    const details = Array.isArray(payload.error.details) ? payload.error.details.join('; ') : '';
    throw new Error(`ArcGIS error for ${source.municipality}: ${message}${details ? ` (${details})` : ''}`);
  }

  const features = Array.isArray(payload?.features) ? payload.features : [];
  return { features, exceeded: Boolean(payload?.exceededTransferLimit) && features.length >= limit };
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return {};
  }
}

function extractRecord(source, attributes) {
  const scheduleNumber = normaliseScheduleNumber(attributes?.[source.scheduleField]);
  if (!scheduleNumber) {
    return null;
  }

  const rawLicenseId = attributes?.[source.licenseIdField];
  const licenseId = rawLicenseId === null || rawLicenseId === undefined ? null : String(rawLicenseId).trim();
  if (!licenseId) {
    return null;
  }

  const rawStatus = attributes?.[source.statusField];
  const status = rawStatus === null || rawStatus === undefined ? 'Unknown' : String(rawStatus).trim() || 'Unknown';
  const normalizedStatus = normaliseStatus(rawStatus);

  const expirationValue = source.expirationField ? attributes?.[source.expirationField] : null;
  const expirationDate = parseDate(expirationValue);

  const updatedValue = source.updatedField ? attributes?.[source.updatedField] : null;
  const updatedDate = parseDate(updatedValue);

  const detailUrl = buildDetailUrl(source.detailUrlTemplate, attributes);

  return {
    id: buildRecordId(source.municipality, licenseId),
    municipality: source.municipality,
    scheduleNumber,
    licenseId,
    status,
    normalizedStatus,
    expirationDate,
    updatedDate,
    detailUrl,
    raw: toPlainObject(attributes ?? {}),
  };
}

async function fetchSourceRecords(source, logger) {
  const pageSize = 2000;
  const results = [];
  let offset = 0;

  while (true) {
    const { features, exceeded } = await fetchFeaturePage(source, offset, pageSize);
    for (const feature of features) {
      const attributes = feature?.attributes ?? feature ?? {};
      const record = extractRecord(source, attributes);
      if (record) {
        results.push(record);
      }
    }

    if (!exceeded || features.length === 0) {
      break;
    }
    offset += pageSize;
  }

  logger?.info?.(
    `[metrics] Fetched ${results.length.toLocaleString()} municipal STR licenses for ${source.municipality}.`,
  );

  return results;
}

export async function fetchMunicipalLicenseRecords(logger = console) {
  const sources = loadMunicipalSources();
  const records = [];
  const failures = [];

  for (const source of sources) {
    if (!source.layerUrl) {
      logger?.warn?.(
        `[metrics] Municipal roster "${source.key}" is missing a layer URL; skipping.`,
      );
      continue;
    }

    try {
      const sourceRecords = await fetchSourceRecords(source, logger);
      records.push(...sourceRecords);
    } catch (error) {
      failures.push({ source, error });
      logger?.error?.(`Failed to fetch municipal roster for ${source.municipality}: ${error?.message ?? error}`);
    }
  }

  if (records.length === 0 && failures.length === sources.length && sources.length > 0) {
    const details = failures
      .map(({ source, error }) => `${source.municipality}: ${error?.message ?? error}`)
      .join('; ');
    throw new Error(`Failed to fetch municipal rosters from ArcGIS (${details})`);
  }

  return records;
}

export function summariseMunicipalLicenses(records) {
  const municipalities = new Set(records.map((record) => record.municipality));
  return {
    total: records.length,
    municipalities: municipalities.size,
  };
}

export function normaliseMunicipalRecordForSupabase(record) {
  const sourceUpdatedAtIso = record.updatedDate
    ? `${record.updatedDate}T00:00:00Z`
    : null;

  return {
    id: record.id,
    schedule_number: record.scheduleNumber,
    municipality: record.municipality,
    municipal_license_id: record.licenseId,
    status: record.status,
    normalized_status: record.normalizedStatus,
    expiration_date: record.expirationDate,
    source_updated_at: sourceUpdatedAtIso,
    detail_url: record.detailUrl ?? null,
    raw: record.raw,
  };
}

export function groupLicensesBySchedule(records) {
  const bySchedule = new Map();
  for (const record of records) {
    const bucket = bySchedule.get(record.scheduleNumber) ?? [];
    bucket.push(record);
    bySchedule.set(record.scheduleNumber, bucket);
  }
  return bySchedule;
}
