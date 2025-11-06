import {
  fetchMunicipalLicenseRecords,
  normaliseMunicipalRecordForSupabase,
  summariseMunicipalLicenses,
} from './municipalRosters.mjs';

const NON_PERSON_DATA_URL = new URL('../src/data/nonPersonOwnerNames.json', import.meta.url);

async function loadJsonResource(resourceUrl) {
  if (typeof Deno !== 'undefined' && typeof Deno.readTextFile === 'function') {
    const text = await Deno.readTextFile(resourceUrl);
    return JSON.parse(text);
  }

  const [{ readFile }, { fileURLToPath }] = await Promise.all([
    import('node:fs/promises'),
    import('node:url'),
  ]);
  const filePath = fileURLToPath(resourceUrl);
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

const nonPersonOwnerNames = await loadJsonResource(NON_PERSON_DATA_URL);

const PAGE_SIZE = 1000;
const MAX_SIGNAL_DEPTH = 4;
const MAX_SIGNAL_ARRAY_LENGTH = 25;
const SCHEMA_CACHE_ERROR_CODES = new Set(['PGRST204', 'PGRST205']);
const SCHEMA_CACHE_RETRY_LIMIT = 5;
const SCHEMA_CACHE_RETRY_DELAY_MS = 750;

const DATE_KEY_HINT = /(date|dt|year|record|recept|sale|deed|permit|license|renew|transfer|expir|assess|valuation|updated|entered|filed|document)/i;
const DATE_VALUE_HINT = /(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{2}|\d{4}))|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+(?:\d{2}|\d{4}))|(\b(19|20)\d{2}\b)/i;

const SIGNAL_TYPE_RULES = [
  { type: 'permit', pattern: /(license|permit|renew|expir|str[_-]?permit|lodging)/i },
  { type: 'transfer', pattern: /(sale|deed|recept|record|doc|transfer)/i },
  { type: 'assessment', pattern: /(assess|valuation|actualvalue|marketvalue|apprais|taxyear|levy)/i },
  { type: 'update', pattern: /(update|modified|change|entered|capture|created)/i },
];

const RENEWAL_METHODS = new Set([
  'direct_permit',
  'transfer_cycle',
  'assessment_cycle',
  'update_cycle',
  'generic_cycle',
]);

const RENEWAL_CATEGORIES = new Set(['overdue', 'due_30', 'due_60', 'due_90', 'future', 'missing']);

const MANUAL_NON_PERSON_NAMES = new Set(
  Array.isArray(nonPersonOwnerNames) ? nonPersonOwnerNames.map((value) => String(value).toUpperCase()) : [],
);

const ORGANIZATION_PATTERNS = [
  /\b(?:LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO\.|LTD|LIMITED|LP|L\.P\.|LLP|L\.L\.P\.|LLLP|PLC|PLLC|PC|P\.C\.|RLLP)\b/,
  /\b(?:ASSOCIATION|ASSN|ASSOC|HOA|POA|COA|MASTER|HOMEOWNERS?|CONDOMINIUMS?|CONDOMINIUM|CONDO|RESORT|LODGE|HOTEL|INN|TIMESHARE|VACATION|VILLAGE|CLUB|RESIDENCES?|SUITES|APARTMENTS?|COMMON ELEMENT)\b/,
  /\b(?:PARTNERS|PARTNERSHIP|INVESTMENTS?|INVESTORS?|CAPITAL|VENTURES?|ENTERPRISES?|GROUP|MANAGEMENT|MGMT|SERVICES?|SOLUTIONS?|ADVISORS?|CONSULTING|HOLDINGS?|HOLDING|DEVELOPMENT|DEVELOPERS?|PROPERTIES?|PROPERTY|REALTY|REAL ESTATE|HOMES?|HOSPITALITY|OPERATIONS|OPERATION|LODGING|RENTALS?)\b/,
  /\b(?:TRUST|ESTATE|FOUNDATION|FUND|MINISTRIES|CHURCH|CATHOLIC|LUTHERAN|METHODIST|PRESBYTERIAN|EPISCOPAL|SOCIETY|HOSPITAL|UNIVERSITY|COLLEGE|SCHOOL|ACADEMY|BANK|MORTGAGE|CREDIT UNION|ASSOCIATES?)\b/,
  /\b(?:TOWN|CITY|COUNTY|STATE|DISTRICT|DEPARTMENT|DEPT|AUTHORITY|BOARD|COMMISSIONERS?|COMMISSION|COUNCIL|HOUSING|URBAN|RENEWAL|METROPOLITAN|GOVERNMENT|PUBLIC|FIRE PROTECTION|FIRE DISTRICT|SANITATION|METRO DISTRICT)\b/,
  /\b(?:C\/O|CARE OF|ET AL|ET UX|ET VIR|ET ALIA)\b/,
  /\b(?:UNITED STATES|U\.S\.|USA)\b/,
  /\b(?:SUMMIT COUNTY|BRECKENRIDGE|DILLON|FRISCO|SILVERTHORNE|COPPER MOUNTAIN|KEYSTONE) (?:TOWN|CITY|COUNTY|METRO|AUTHORITY)\b/,
  /[#]/,
];

function isLikelyOrganization(name) {
  if (!name) {
    return true;
  }
  const normalised = String(name).trim();
  if (normalised.length === 0) {
    return true;
  }
  const collapsed = normalised.replace(/\s+/g, ' ');
  const upper = collapsed.toUpperCase();
  if (MANUAL_NON_PERSON_NAMES.has(upper)) {
    return true;
  }
  for (const pattern of ORGANIZATION_PATTERNS) {
    if (pattern.test(upper)) {
      return true;
    }
  }
  if (/\d/.test(upper) && !/\b(?:I|II|III|IV|V)\b/.test(upper)) {
    return true;
  }
  return false;
}

function normaliseRenewalMethod(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return RENEWAL_METHODS.has(trimmed) ? trimmed : null;
}

function normaliseRenewalCategory(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return RENEWAL_CATEGORIES.has(trimmed) ? trimmed : null;
}

function normaliseMonthKey(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normaliseSubdivision(value) {
  if (!value || typeof value !== 'string') {
    return 'Unknown subdivision';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Unknown subdivision';
}

function normaliseZone(value) {
  if (!value || typeof value !== 'string') {
    return 'Unknown zone';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Unknown zone';
}

function sanitiseOwnerDisplay(value) {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const withoutEtAl = trimmed.replace(/\bET\s*AL\.?$/i, '').trim();
  return (withoutEtAl || trimmed).replace(/\s*&\s*/g, ' & ');
}

function normaliseOwnerName(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const display = sanitiseOwnerDisplay(value);
  if (!display) {
    return null;
  }

  const key = display
    .replace(/[^A-Z0-9& ]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  if (
    !key ||
    key === 'UNKNOWN' ||
    key === 'UNAVAILABLE' ||
    key === 'NOT PROVIDED' ||
    key === 'NO OWNER' ||
    key === 'N/A' ||
    key === 'NA'
  ) {
    return null;
  }

  return { key, display };
}

function collectOwnerNames(listing) {
  const owners = [];

  if (Array.isArray(listing.owner_names)) {
    for (const entry of listing.owner_names) {
      const normalised = normaliseOwnerName(entry);
      if (normalised) {
        owners.push(normalised);
      }
    }
  }

  if (owners.length === 0) {
    const fallback = normaliseOwnerName(listing.owner_name);
    if (fallback) {
      owners.push(fallback);
    }
  }

  return owners;
}

async function applyBusinessOwnerCorrections(supabase, listingIds, logger) {
  const batchSize = 500;
  for (let index = 0; index < listingIds.length; index += batchSize) {
    const batch = listingIds.slice(index, index + batchSize);
    await withSupabaseRetry(
      () => supabase.from('listings').update({ is_business_owner: true }).in('id', batch),
      `mark business-owned listings batch ${index + 1}-${index + batch.length}`,
      logger,
    );
  }
  logger.info?.(
    `[metrics] Marked ${listingIds.length.toLocaleString()} listings as business-owned via heuristics.`,
  );
}

function normaliseScheduleNumber(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function normaliseMunicipality(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\s+/g, ' ');
}

const MUNICIPAL_STATUS_RANKS = new Map([
  ['active', 5],
  ['pending', 3],
  ['unknown', 1],
  ['expired', 0],
  ['inactive', -1],
  ['revoked', -2],
]);

function rankMunicipalStatus(status) {
  if (!status) {
    return MUNICIPAL_STATUS_RANKS.get('unknown');
  }
  return MUNICIPAL_STATUS_RANKS.get(status) ?? MUNICIPAL_STATUS_RANKS.get('unknown');
}

function isMunicipalStatusActive(status) {
  if (!status) {
    return false;
  }
  const normalised = status.toLowerCase();
  return normalised === 'active' || normalised === 'pending';
}

function normaliseMunicipalLicenseList(value) {
  if (!value) {
    return null;
  }
  try {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date, years) {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseDateValue(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    if (value >= 1900 && value <= 2100) {
      return new Date(Date.UTC(value, 0, 1));
    }
    if (value > 1e12) {
      return new Date(value);
    }
    if (value > 1e9) {
      return new Date(value * 1000);
    }
    return new Date(value * 24 * 60 * 60 * 1000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const isoMatch = trimmed.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const arcgisEpoch = trimmed.match(/\/Date\((\d+)\)\//);
    if (arcgisEpoch) {
      const ms = Number.parseInt(arcgisEpoch[1], 10);
      if (!Number.isNaN(ms)) {
        return new Date(ms);
      }
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return parseDateValue(numeric);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function compareMunicipalLicenses(a, b) {
  const rankDifference = rankMunicipalStatus(b.normalizedStatus) - rankMunicipalStatus(a.normalizedStatus);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  const aExpiration = a.expirationDate instanceof Date ? a.expirationDate.getTime() : 0;
  const bExpiration = b.expirationDate instanceof Date ? b.expirationDate.getTime() : 0;
  if (aExpiration !== bExpiration) {
    return bExpiration - aExpiration;
  }

  return a.licenseId.localeCompare(b.licenseId, undefined, { sensitivity: 'base' });
}

function selectPrimaryMunicipalLicense(licenses) {
  if (!Array.isArray(licenses) || licenses.length === 0) {
    return null;
  }
  const sorted = [...licenses].sort(compareMunicipalLicenses);
  return sorted[0] ?? null;
}

function serialiseMunicipalLicenses(licenses) {
  if (!Array.isArray(licenses) || licenses.length === 0) {
    return null;
  }
  const sorted = [...licenses].sort(compareMunicipalLicenses);
  return sorted.map((license) => ({
    municipality: license.municipality,
    license_id: license.licenseId,
    status: license.status,
    normalized_status: license.normalizedStatus,
    expiration_date: license.expirationDateIso ?? null,
    detail_url: license.detailUrl ?? null,
    source_updated_at: license.sourceUpdatedAtIso ?? null,
  }));
}

function normaliseMunicipalAssignmentList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const normalised = list
    .map((item) => ({
      municipality: item.municipality ?? '',
      license_id: item.license_id ?? '',
      status: item.status ?? '',
      normalized_status: item.normalized_status ?? '',
      expiration_date: item.expiration_date ?? null,
      detail_url: item.detail_url ?? null,
      source_updated_at: item.source_updated_at ?? null,
    }))
    .sort((a, b) => a.license_id.localeCompare(b.license_id, undefined, { sensitivity: 'base' }));

  return JSON.stringify(normalised);
}

function classifySignalType(path) {
  const normalised = path.toLowerCase();
  for (const rule of SIGNAL_TYPE_RULES) {
    if (rule.pattern.test(normalised)) {
      return rule.type;
    }
  }
  return 'generic';
}

function shouldParseValue(path, value) {
  if (!path) {
    return false;
  }
  if (DATE_KEY_HINT.test(path)) {
    return true;
  }
  if (typeof value === 'string' && DATE_VALUE_HINT.test(value)) {
    return true;
  }
  return false;
}

function collectDatesFromValue(value) {
  if (Array.isArray(value)) {
    const results = [];
    for (const entry of value.slice(0, MAX_SIGNAL_ARRAY_LENGTH)) {
      const parsed = parseDateValue(entry);
      if (parsed) {
        results.push(parsed);
      }
    }
    return results;
  }

  const parsed = parseDateValue(value);
  return parsed ? [parsed] : [];
}

function collectRenewalSignals(raw) {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const results = new Map();

  function traverse(value, path, depth) {
    if (depth > MAX_SIGNAL_DEPTH || value == null) {
      return;
    }

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_SIGNAL_ARRAY_LENGTH);
      for (let index = 0; index < limit; index += 1) {
        traverse(value[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }

    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        traverse(child, nextPath, depth + 1);
      }
      return;
    }

    if (!shouldParseValue(path, value)) {
      return;
    }

    const dates = collectDatesFromValue(value);
    if (dates.length === 0) {
      return;
    }

    const type = classifySignalType(path);
    for (const date of dates) {
      if (!date) {
        continue;
      }
      const key = `${type}:${path}:${date.getTime()}`;
      if (!results.has(key)) {
        results.set(key, { type, path, date, rawValue: value });
      }
    }
  }

  traverse(raw, '', 0);
  return Array.from(results.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function inferAssessmentRenewal(signals, today) {
  if (signals.length === 0) {
    return null;
  }

  const latest = signals[signals.length - 1];
  let baseYear = latest.date.getUTCFullYear();
  if (baseYear % 2 === 0) {
    baseYear += 1;
  }
  let nextYear = baseYear + 2;
  let candidate = new Date(Date.UTC(nextYear, 4, 1));
  while (candidate <= today) {
    nextYear += 2;
    candidate = new Date(Date.UTC(nextYear, 4, 1));
  }
  return { date: candidate, method: 'assessment_cycle', reference: latest.date };
}

function inferCycleRenewal(latestSignal, cycleYears, method, today) {
  if (!latestSignal) {
    return null;
  }
  let candidate = addYears(latestSignal.date, cycleYears);
  while (candidate <= today) {
    candidate = addYears(candidate, cycleYears);
  }
  return { date: candidate, method, reference: latestSignal.date };
}

function inferDirectRenewal(signals, today) {
  if (signals.length === 0) {
    return null;
  }

  const upcoming = signals.find((signal) => signal.date >= today);
  if (upcoming) {
    return { date: upcoming.date, method: 'direct_permit', reference: upcoming.date };
  }

  const latest = signals[signals.length - 1];
  return { date: latest.date, method: 'direct_permit', reference: latest.date };
}

function estimateRenewal(raw, today) {
  const signals = collectRenewalSignals(raw);
  if (signals.length === 0) {
    return null;
  }

  const permitSignals = signals.filter((signal) => signal.type === 'permit');
  if (permitSignals.length > 0) {
    return inferDirectRenewal(permitSignals, today);
  }

  const transferSignals = signals.filter((signal) => signal.type === 'transfer');
  if (transferSignals.length > 0) {
    return inferCycleRenewal(transferSignals[transferSignals.length - 1], 1, 'transfer_cycle', today);
  }

  const assessmentSignals = signals.filter((signal) => signal.type === 'assessment');
  if (assessmentSignals.length > 0) {
    return inferAssessmentRenewal(assessmentSignals, today);
  }

  const updateSignals = signals.filter((signal) => signal.type === 'update');
  if (updateSignals.length > 0) {
    return inferCycleRenewal(updateSignals[updateSignals.length - 1], 1, 'update_cycle', today);
  }

  const latest = signals[signals.length - 1];
  return inferCycleRenewal(latest, 1, 'generic_cycle', today);
}

async function fetchListings(supabase, pageSize, logger) {
  const listings = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data } = await withSupabaseRetry(
      () =>
        supabase
          .from('listings')
          .select(
            'id, schedule_number, subdivision, zone, owner_name, owner_names, is_business_owner, estimated_renewal_date, estimated_renewal_method, estimated_renewal_reference, estimated_renewal_month_key, estimated_renewal_category, municipal_municipality, municipal_license_id, municipal_license_status, municipal_license_normalized_status, municipal_license_expires_on, municipal_licenses, raw',
          )
          .order('id', { ascending: true })
          .range(from, to),
      `fetch listings range ${from}-${to}`,
      logger,
    );

    const rows = Array.isArray(data) ? data : [];
    listings.push(...rows);

    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }

    logger.info?.(`Fetched ${listings.length.toLocaleString()} listings so far…`);
  }

  return listings;
}

async function fetchMunicipalLicenses(supabase, pageSize, logger) {
  const licenses = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data } = await withSupabaseRetry(
      () =>
        supabase
          .from('municipal_licenses')
          .select(
            'id, schedule_number, municipality, municipal_license_id, status, normalized_status, expiration_date, source_updated_at, detail_url',
          )
          .order('schedule_number', { ascending: true })
          .range(from, to),
      `fetch municipal licenses range ${from}-${to}`,
      logger,
    );

    const rows = Array.isArray(data) ? data : [];
    licenses.push(...rows);

    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }

    logger.info?.(`Fetched ${licenses.length.toLocaleString()} municipal license records so far…`);
  }

  return licenses;
}

async function writeSubdivisionMetrics(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    subdivision: row.subdivision,
    total_listings: row.totalListings,
    business_owner_count: row.businessOwners,
    individual_owner_count: row.individualOwners,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('listing_subdivision_metrics').delete().neq('subdivision', ''),
    'clear subdivision metrics',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('listing_subdivision_metrics').insert(payload),
    'insert subdivision metrics',
    logger,
  );
}

async function writeZoneMetrics(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    zone: row.zone,
    total_listings: row.totalListings,
    business_owner_count: row.businessOwners,
    individual_owner_count: row.individualOwners,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('listing_zone_metrics').delete().neq('zone', ''),
    'clear zone metrics',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('listing_zone_metrics').insert(payload),
    'insert zone metrics',
    logger,
  );
}

async function applyMunicipalLicenseAssignments(supabase, assignments, logger) {
  if (!assignments.length) {
    return 0;
  }

  const chunkSize = 400;
  for (let start = 0; start < assignments.length; start += chunkSize) {
    const chunk = assignments.slice(start, start + chunkSize);
    await withSupabaseRetry(
      () => supabase.from('listings').upsert(chunk, { onConflict: 'id' }),
      `upsert municipal license assignments ${start + 1}-${start + chunk.length}`,
      logger,
    );
  }

  logger.info?.(
    `[metrics] Updated municipal permit assignments for ${assignments.length.toLocaleString()} listings.`,
  );
  return assignments.length;
}

async function writeMunicipalityMetrics(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    municipality: row.municipality,
    total_listings: row.totalListings,
    licensed_listing_count: row.licensedListings,
    business_owner_count: row.businessOwners,
    individual_owner_count: row.individualOwners,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('listing_municipality_metrics').delete().neq('municipality', ''),
    'clear municipality metrics',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('listing_municipality_metrics').insert(payload),
    'insert municipality metrics',
    logger,
  );
}

async function writeRenewalTimeline(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    renewal_month: row.month,
    listing_count: row.count,
    earliest_renewal: row.earliest,
    latest_renewal: row.latest,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('listing_renewal_metrics').delete().neq('renewal_month', '1900-01-01'),
    'clear renewal timeline metrics',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('listing_renewal_metrics').insert(payload),
    'insert renewal timeline metrics',
    logger,
  );
}

async function writeRenewalSummary(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    category: row.category,
    listing_count: row.count,
    window_start: row.windowStart,
    window_end: row.windowEnd,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('listing_renewal_summary').delete().neq('category', '__placeholder__'),
    'clear renewal summary metrics',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('listing_renewal_summary').insert(payload),
    'insert renewal summary metrics',
    logger,
  );
}

async function writeRenewalMethodSummary(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    method: row.method,
    listing_count: row.count,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('listing_renewal_method_summary').delete().neq('method', '__placeholder__'),
    'clear renewal method summary',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('listing_renewal_method_summary').insert(payload),
    'insert renewal method summary',
    logger,
  );
}

async function writeLandBaronLeaderboard(supabase, rows, refreshedAt, logger) {
  const payload = rows.map((row) => ({
    owner_name: row.ownerName,
    property_count: row.propertyCount,
    business_property_count: row.businessPropertyCount,
    individual_property_count: row.individualPropertyCount,
    updated_at: refreshedAt,
  }));

  await withSupabaseRetry(
    () => supabase.from('land_baron_leaderboard').delete().neq('owner_name', ''),
    'clear land baron leaderboard',
    logger,
  );

  if (payload.length === 0) {
    return;
  }

  await withSupabaseRetry(
    () => supabase.from('land_baron_leaderboard').insert(payload),
    'insert land baron leaderboard',
    logger,
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSchemaCacheError(error) {
  return Boolean(error && typeof error.code === 'string' && SCHEMA_CACHE_ERROR_CODES.has(error.code));
}

function isRetryableNetworkError(error) {
  if (!error) {
    return false;
  }
  if (error instanceof TypeError) {
    return error.message === 'Failed to fetch';
  }
  if (typeof error === 'object') {
    const message = error?.message;
    if (typeof message === 'string' && message.includes('Failed to fetch')) {
      return true;
    }
    const code = error?.code;
    if (typeof code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) {
      return true;
    }
  }
  return false;
}

async function withSupabaseRetry(operation, context, logger, attempt = 0) {
  try {
    const result = await operation();
    const error = result && typeof result === 'object' && 'error' in result ? result.error : null;
    if (!error) {
      return result;
    }
    if (isSchemaCacheError(error) && attempt < SCHEMA_CACHE_RETRY_LIMIT) {
      const delay = SCHEMA_CACHE_RETRY_DELAY_MS * (attempt + 1);
      logger?.warn?.(
        `[metrics] ${context} failed due to Supabase schema cache (${error.code}). Retrying in ${delay}ms…`,
      );
      await wait(delay);
      return withSupabaseRetry(operation, context, logger, attempt + 1);
    }
    throw error;
  } catch (error) {
    if (isRetryableNetworkError(error) && attempt < SCHEMA_CACHE_RETRY_LIMIT) {
      const delay = SCHEMA_CACHE_RETRY_DELAY_MS * (attempt + 1);
      logger?.warn?.(
        `[metrics] ${context} encountered a network error (${error?.message ?? error}). Retrying in ${delay}ms…`,
      );
      await wait(delay);
      return withSupabaseRetry(operation, context, logger, attempt + 1);
    }
    throw error;
  }
}

async function refreshMunicipalLicenseTable(supabase, logger) {
  const municipalRecords = await fetchMunicipalLicenseRecords(logger);
  const summary = summariseMunicipalLicenses(municipalRecords);
  logger.info?.(
    `[metrics] Retrieved ${summary.total.toLocaleString()} municipal license records across ${summary.municipalities.toLocaleString()} municipalities.`,
  );

  const supabaseRows = municipalRecords.map((record) => normaliseMunicipalRecordForSupabase(record));

  await withSupabaseRetry(
    () => supabase.from('municipal_licenses').delete().neq('id', ''),
    'clear municipal licenses',
    logger,
  );

  if (supabaseRows.length === 0) {
    logger.warn?.('[metrics] Municipal license roster is empty after refresh.');
    return [];
  }

  const chunkSize = 500;
  for (let start = 0; start < supabaseRows.length; start += chunkSize) {
    const chunk = supabaseRows.slice(start, start + chunkSize);
    await withSupabaseRetry(
      () => supabase.from('municipal_licenses').upsert(chunk, { onConflict: 'id' }),
      `upsert municipal license chunk ${start + 1}-${start + chunk.length}`,
      logger,
    );
  }

  return supabaseRows;
}

export async function refreshListingAggregates(
  supabase,
  options = {},
) {
  const { logger = console, pageSize = PAGE_SIZE } = options;

  logger.info?.('[metrics] Fetching listings dataset…');
  const listings = await fetchListings(supabase, pageSize, logger);
  logger.info?.(`[metrics] Loaded ${listings.length.toLocaleString()} listing records.`);

  logger.info?.('[metrics] Fetching municipal license roster…');
  let municipalLicenseRows = [];
  try {
    municipalLicenseRows = await refreshMunicipalLicenseTable(supabase, logger);
  } catch (error) {
    logger.error?.(
      `[metrics] Failed to refresh municipal license roster from ArcGIS (${error?.message ?? error}). Falling back to Supabase cache…`,
    );
    municipalLicenseRows = await fetchMunicipalLicenses(supabase, pageSize, logger);
  }
  if (municipalLicenseRows.length === 0) {
    logger.warn?.('[metrics] Municipal license roster is empty; downstream aggregates will omit municipal coverage.');
  }
  const licensesBySchedule = new Map();
  for (const row of municipalLicenseRows) {
    const scheduleNumber = normaliseScheduleNumber(row.schedule_number);
    if (!scheduleNumber) {
      continue;
    }
    const municipality = normaliseMunicipality(row.municipality);
    if (!municipality) {
      continue;
    }
    const licenseId = row.municipal_license_id ? String(row.municipal_license_id).trim() : '';
    if (!licenseId) {
      continue;
    }
    const status = row.status && String(row.status).trim().length > 0 ? String(row.status).trim() : 'Unknown';
    const normalizedStatusRaw = row.normalized_status ? String(row.normalized_status).trim().toLowerCase() : '';
    const normalizedStatus = normalizedStatusRaw || 'unknown';
    const expirationDate = parseDateValue(row.expiration_date);
    const expirationDateIso = formatDate(expirationDate);
    const sourceUpdatedAt = row.source_updated_at ? new Date(row.source_updated_at) : null;
    const sourceUpdatedAtIso =
      sourceUpdatedAt instanceof Date && !Number.isNaN(sourceUpdatedAt.getTime())
        ? sourceUpdatedAt.toISOString()
        : null;
    const detailUrl = row.detail_url ? String(row.detail_url) : null;

    const entry = {
      municipality,
      licenseId,
      status,
      normalizedStatus,
      expirationDate,
      expirationDateIso,
      detailUrl,
      sourceUpdatedAtIso,
    };

    const bucket = licensesBySchedule.get(scheduleNumber) || [];
    bucket.push(entry);
    licensesBySchedule.set(scheduleNumber, bucket);
  }

  logger.info?.(
    `[metrics] Loaded ${municipalLicenseRows.length.toLocaleString()} municipal license records across ${licensesBySchedule.size.toLocaleString()} schedules.`,
  );

  const subdivisions = new Map();
  const zones = new Map();
  const municipalities = new Map();
  const owners = new Map();
  const renewalBuckets = new Map();
  const methodCounts = new Map();
  const municipalAssignments = [];
  const summary = {
    overdue: { count: 0, windowStart: null, windowEnd: null },
    due_30: { count: 0, windowStart: null, windowEnd: null },
    due_60: { count: 0, windowStart: null, windowEnd: null },
    due_90: { count: 0, windowStart: null, windowEnd: null },
  future: { count: 0, windowStart: null, windowEnd: null },
  missing: { count: 0, windowStart: null, windowEnd: null },
};

  const businessOwnerCorrections = new Set();

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const in30 = addDays(today, 30);
  const in60 = addDays(today, 60);
  const in90 = addDays(today, 90);

  summary.overdue.windowEnd = formatDate(addDays(today, -1));
  summary.due_30.windowStart = formatDate(today);
  summary.due_30.windowEnd = formatDate(in30);
  summary.due_60.windowStart = formatDate(addDays(in30, 1));
  summary.due_60.windowEnd = formatDate(in60);
  summary.due_90.windowStart = formatDate(addDays(in60, 1));
  summary.due_90.windowEnd = formatDate(in90);
  summary.future.windowStart = formatDate(addDays(in90, 1));

  listings.forEach((listing) => {
    const ownerCandidates = collectOwnerNames(listing);
    const inferredBusinessOwner = ownerCandidates.some((owner) =>
      isLikelyOrganization(owner.display),
    );
    const listingIsBusiness = Boolean(listing.is_business_owner) || inferredBusinessOwner;

    const scheduleNumber = normaliseScheduleNumber(listing.schedule_number);
    const licenseCandidates = scheduleNumber ? licensesBySchedule.get(scheduleNumber) || [] : [];
    const primaryMunicipalLicense = selectPrimaryMunicipalLicense(licenseCandidates);
    const serialisedMunicipalLicenses = serialiseMunicipalLicenses(licenseCandidates);
    const existingMunicipalLicenses = normaliseMunicipalLicenseList(listing.municipal_licenses);
    const existingMunicipalLicensesKey = existingMunicipalLicenses
      ? normaliseMunicipalAssignmentList(existingMunicipalLicenses)
      : null;
    const nextMunicipalLicensesKey = serialisedMunicipalLicenses
      ? normaliseMunicipalAssignmentList(serialisedMunicipalLicenses)
      : null;

    if (primaryMunicipalLicense) {
      const municipalityKey = primaryMunicipalLicense.municipality;
      const municipalStats = municipalities.get(municipalityKey) || {
        total: 0,
        business: 0,
        individual: 0,
        licensed: 0,
      };
      municipalStats.total += 1;
      if (listingIsBusiness) {
        municipalStats.business += 1;
      } else {
        municipalStats.individual += 1;
      }
      if (isMunicipalStatusActive(primaryMunicipalLicense.normalizedStatus)) {
        municipalStats.licensed += 1;
      }
      municipalities.set(municipalityKey, municipalStats);
    }

    const targetMunicipality = primaryMunicipalLicense ? primaryMunicipalLicense.municipality : null;
    const targetLicenseId = primaryMunicipalLicense ? primaryMunicipalLicense.licenseId : null;
    const targetStatus = primaryMunicipalLicense ? primaryMunicipalLicense.status : null;
    const targetNormalizedStatus = primaryMunicipalLicense
      ? primaryMunicipalLicense.normalizedStatus
      : null;
    const targetExpiration = primaryMunicipalLicense ? primaryMunicipalLicense.expirationDateIso : null;

    const existingMunicipality = listing.municipal_municipality || null;
    const existingLicenseId = listing.municipal_license_id || null;
    const existingStatus = listing.municipal_license_status || null;
    const existingNormalizedStatus = listing.municipal_license_normalized_status || null;
    const existingExpiration = formatDate(parseDateValue(listing.municipal_license_expires_on)) || null;

    const shouldUpdateMunicipalAssignment =
      (existingMunicipality || null) !== (targetMunicipality || null) ||
      (existingLicenseId || null) !== (targetLicenseId || null) ||
      (existingStatus || null) !== (targetStatus || null) ||
      (existingNormalizedStatus || null) !== (targetNormalizedStatus || null) ||
      (existingExpiration || null) !== (targetExpiration || null) ||
      existingMunicipalLicensesKey !== nextMunicipalLicensesKey;

    if (shouldUpdateMunicipalAssignment) {
      municipalAssignments.push({
        id: listing.id,
        municipal_municipality: targetMunicipality,
        municipal_license_id: targetLicenseId,
        municipal_license_status: targetStatus,
        municipal_license_normalized_status: targetNormalizedStatus,
        municipal_license_expires_on: targetExpiration,
        municipal_licenses: serialisedMunicipalLicenses,
      });
    }

    if (!listing.is_business_owner && listingIsBusiness && listing.id) {
      businessOwnerCorrections.add(listing.id);
    }

    const subdivision = normaliseSubdivision(listing.subdivision);
    const stats = subdivisions.get(subdivision) || { total: 0, business: 0 };
    stats.total += 1;
    if (listingIsBusiness) {
      stats.business += 1;
    }
    subdivisions.set(subdivision, stats);

    const zone = normaliseZone(listing.zone);
    const zoneStats = zones.get(zone) || { total: 0, business: 0 };
    zoneStats.total += 1;
    if (listingIsBusiness) {
      zoneStats.business += 1;
    }
    zones.set(zone, zoneStats);

    if (ownerCandidates.length > 0) {
      const seen = new Set();
      for (const owner of ownerCandidates) {
        if (seen.has(owner.key)) {
          continue;
        }
        seen.add(owner.key);

        const existing = owners.get(owner.key) || {
          ownerName: owner.display,
          propertyCount: 0,
          businessPropertyCount: 0,
          individualPropertyCount: 0,
        };

        if (!existing.ownerName || owner.display.length > existing.ownerName.length) {
          existing.ownerName = owner.display;
        }

        existing.propertyCount += 1;
        if (listingIsBusiness) {
          existing.businessPropertyCount += 1;
        } else {
          existing.individualPropertyCount += 1;
        }

        owners.set(owner.key, existing);
      }
    }

    const storedRenewalDate = parseDateValue(listing.estimated_renewal_date);
    const storedRenewalMethod = normaliseRenewalMethod(listing.estimated_renewal_method);
    const storedRenewalReference = parseDateValue(listing.estimated_renewal_reference);
    const storedRenewalMonthKey = normaliseMonthKey(listing.estimated_renewal_month_key);
    const storedRenewalCategory = normaliseRenewalCategory(listing.estimated_renewal_category);

    let estimation = null;
    if (storedRenewalDate) {
      estimation = {
        date: storedRenewalDate,
        method: storedRenewalMethod || 'generic_cycle',
        reference: storedRenewalReference ?? null,
      };
    } else {
      estimation = estimateRenewal(listing.raw, today);
    }

    if (!estimation || !(estimation.date instanceof Date) || Number.isNaN(estimation.date.getTime())) {
      if (storedRenewalCategory && summary[storedRenewalCategory]) {
        summary[storedRenewalCategory].count += 1;
      } else {
        summary.missing.count += 1;
      }
      return;
    }

    const renewalDate = estimation.date;
    const method = normaliseRenewalMethod(estimation.method) || storedRenewalMethod;
    if (method) {
      methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
    }

    const bucketDate = storedRenewalMonthKey
      ? parseDateValue(`${storedRenewalMonthKey}-01`)
      : new Date(Date.UTC(renewalDate.getUTCFullYear(), renewalDate.getUTCMonth(), 1));
    const bucketKey = formatDate(bucketDate);
    if (bucketKey) {
      const bucket = renewalBuckets.get(bucketKey) || {
        count: 0,
        earliest: renewalDate,
        latest: renewalDate,
      };
      bucket.count += 1;
      if (renewalDate < bucket.earliest) {
        bucket.earliest = renewalDate;
      }
      if (renewalDate > bucket.latest) {
        bucket.latest = renewalDate;
      }
      renewalBuckets.set(bucketKey, bucket);
    }

    if (renewalDate < today) {
      summary.overdue.count += 1;
    } else if (renewalDate <= in30) {
      summary.due_30.count += 1;
    } else if (renewalDate <= in60) {
      summary.due_60.count += 1;
    } else if (renewalDate <= in90) {
      summary.due_90.count += 1;
    } else {
      summary.future.count += 1;
    }
  });

  const reclassifiedBusinessIds = Array.from(businessOwnerCorrections);
  if (reclassifiedBusinessIds.length > 0) {
    logger.info?.(
      `[metrics] Reclassifying ${reclassifiedBusinessIds.length.toLocaleString()} listings as business-owned prior to writing aggregates…`,
    );
    await applyBusinessOwnerCorrections(supabase, reclassifiedBusinessIds, logger);
  }

  const municipalAssignmentUpdates = await applyMunicipalLicenseAssignments(
    supabase,
    municipalAssignments,
    logger,
  );

  const subdivisionRows = Array.from(subdivisions.entries())
    .map(([subdivision, stats]) => ({
      subdivision,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.total - stats.business,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));

  const zoneRows = Array.from(zones.entries())
    .map(([zone, stats]) => ({
      zone,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.total - stats.business,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.zone.localeCompare(b.zone));

  const municipalityRows = Array.from(municipalities.entries())
    .map(([municipality, stats]) => ({
      municipality,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.individual,
      licensedListings: stats.licensed,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.municipality.localeCompare(b.municipality));

  const renewalRows = Array.from(renewalBuckets.entries())
    .map(([month, bucket]) => ({
      month,
      count: bucket.count,
      earliest: formatDate(bucket.earliest),
      latest: formatDate(bucket.latest),
    }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  const summaryRows = Object.entries(summary).map(([category, info]) => ({
    category,
    count: info.count,
    windowStart: info.windowStart,
    windowEnd: info.windowEnd,
  }));

  const methodRows = Array.from(methodCounts.entries()).map(([method, count]) => ({
    method,
    count,
  }));

  const landBaronRows = Array.from(owners.values())
    .filter((row) => row.ownerName && row.propertyCount > 0)
    .map((row) => ({
      ownerName: row.ownerName,
      propertyCount: row.propertyCount,
      businessPropertyCount: row.businessPropertyCount,
      individualPropertyCount: row.individualPropertyCount,
    }))
    .sort(
      (a, b) =>
        b.propertyCount - a.propertyCount ||
        a.ownerName.localeCompare(b.ownerName, undefined, { sensitivity: 'base' }),
    );

  const refreshedAt = new Date().toISOString();

  logger.info?.('[metrics] Writing subdivision metrics…');
  await writeSubdivisionMetrics(supabase, subdivisionRows, refreshedAt, logger);
  logger.info?.('[metrics] Writing zone distribution…');
  await writeZoneMetrics(supabase, zoneRows, refreshedAt, logger);
  logger.info?.('[metrics] Writing municipality distribution…');
  await writeMunicipalityMetrics(supabase, municipalityRows, refreshedAt, logger);
  logger.info?.('[metrics] Writing renewal timeline…');
  await writeRenewalTimeline(supabase, renewalRows, refreshedAt, logger);
  logger.info?.('[metrics] Writing renewal summary…');
  await writeRenewalSummary(supabase, summaryRows, refreshedAt, logger);
  logger.info?.('[metrics] Writing renewal estimation methods…');
  await writeRenewalMethodSummary(supabase, methodRows, refreshedAt, logger);
  logger.info?.('[metrics] Crowning the Land Baron Leaderboard…');
  await writeLandBaronLeaderboard(supabase, landBaronRows, refreshedAt, logger);

  logger.info?.('[metrics] Aggregates refreshed successfully.');

  const totalBusinessOwners = subdivisionRows.reduce((sum, row) => sum + row.businessOwners, 0);
  const totalIndividualOwners = subdivisionRows.reduce((sum, row) => sum + row.individualOwners, 0);

  return {
    refreshedAt,
    listingsProcessed: listings.length,
    subdivisionsWritten: subdivisionRows.length,
    zonesWritten: zoneRows.length,
    municipalitiesWritten: municipalityRows.length,
    renewalTimelineBuckets: renewalRows.length,
    renewalSummaryBuckets: summaryRows.length,
    renewalMethodBuckets: methodRows.length,
    landBaronsWritten: landBaronRows.length,
    totalBusinessOwners,
    totalIndividualOwners,
    businessOwnerReclassifications: reclassifiedBusinessIds.length,
    municipalAssignmentUpdates,
  };
}

export { collectRenewalSignals, estimateRenewal, parseDateValue };
