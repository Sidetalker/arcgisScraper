const PAGE_SIZE = 1000;
const MAX_SIGNAL_DEPTH = 4;
const MAX_SIGNAL_ARRAY_LENGTH = 25;
const OVERLAY_SEARCH_MAX_DEPTH = 4;
const OVERLAY_MAX_ARRAY_LENGTH = 25;

const ZONING_DISTRICT_PATTERNS = [
  /zone(name|district|code)/,
  /zoning(name|district|code)/,
];

const ZONING_DESCRIPTION_PATTERNS = [
  /zone(desc|descr|description)/,
  /zoning(desc|descr|description)/,
  /zoningtype/,
];

const LAND_USE_CATEGORY_PATTERNS = [
  /landuse(category|code|type|class|group|name)/,
];

const LAND_USE_DESCRIPTION_PATTERNS = [
  /landuse(desc|descr|description)/,
  /use(desc|descr|description)/,
];

function normaliseOverlayKey(key) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function coerceOverlayValue(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }

  return '';
}

function extractOverlayAttributesFromRaw(raw) {
  const result = {
    zoningDistrict: '',
    zoningDescription: '',
    landUseCategory: '',
    landUseDescription: '',
  };

  if (!raw || typeof raw !== 'object') {
    return result;
  }

  const visited = new Set();
  const queue = [];

  function enqueue(value, depth) {
    if (depth > OVERLAY_SEARCH_MAX_DEPTH || value == null) {
      return;
    }

    if (typeof value === 'object') {
      if (visited.has(value)) {
        return;
      }
      visited.add(value);
    }

    queue.push({ value, depth });
  }

  enqueue(raw, 0);
  if (raw.attributes && typeof raw.attributes === 'object') {
    enqueue(raw.attributes, 0);
  }

  while (queue.length > 0) {
    const { value, depth } = queue.shift();

    if (Array.isArray(value)) {
      for (const entry of value.slice(0, OVERLAY_MAX_ARRAY_LENGTH)) {
        enqueue(entry, depth + 1);
      }
      continue;
    }

    if (!value || typeof value !== 'object') {
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      const normalisedKey = normaliseOverlayKey(key);

      if (typeof child === 'object' && child !== null) {
        enqueue(child, depth + 1);
      } else if (Array.isArray(child)) {
        enqueue(child, depth + 1);
      }

      const candidate = coerceOverlayValue(child);
      if (!candidate) {
        continue;
      }

      if (!result.zoningDistrict && ZONING_DISTRICT_PATTERNS.some((pattern) => pattern.test(normalisedKey))) {
        result.zoningDistrict = candidate;
        continue;
      }

      if (!result.zoningDescription && ZONING_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalisedKey))) {
        result.zoningDescription = candidate;
        continue;
      }

      if (!result.landUseCategory && LAND_USE_CATEGORY_PATTERNS.some((pattern) => pattern.test(normalisedKey))) {
        result.landUseCategory = candidate;
        continue;
      }

      if (!result.landUseDescription && LAND_USE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalisedKey))) {
        result.landUseDescription = candidate;
      }
    }
  }

  return result;
}

function deriveOverlayAttributes(listing) {
  const extracted = extractOverlayAttributesFromRaw(listing.raw);

  const existingZoningDistrict = coerceOverlayValue(listing.zoning_district);
  const existingZoningDescription = coerceOverlayValue(listing.zoning_description);
  const existingLandUseCategory = coerceOverlayValue(listing.land_use_category);
  const existingLandUseDescription = coerceOverlayValue(listing.land_use_description);

  const zoningDistrict = extracted.zoningDistrict || existingZoningDistrict;
  const zoningDescription = extracted.zoningDescription || existingZoningDescription;
  const landUseCategory = extracted.landUseCategory || existingLandUseCategory;
  const landUseDescription = extracted.landUseDescription || existingLandUseDescription;

  return {
    zoningDistrict,
    zoningDescription,
    landUseCategory,
    landUseDescription,
    existingZoningDistrict,
    existingZoningDescription,
    existingLandUseCategory,
    existingLandUseDescription,
  };
}

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

function normaliseZoningDistrict(value) {
  const candidate = coerceOverlayValue(value);
  return candidate || 'Unknown zoning';
}

function normaliseLandUseCategory(value) {
  const candidate = coerceOverlayValue(value);
  return candidate || 'Unknown land use';
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
    const { data, error } = await supabase
      .from('listings')
      .select(
        'id, subdivision, is_business_owner, zoning_district, zoning_description, land_use_category, land_use_description, estimated_renewal_date, estimated_renewal_method, estimated_renewal_reference, estimated_renewal_month_key, estimated_renewal_category, raw',
      )
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

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

async function writeSubdivisionMetrics(supabase, rows, refreshedAt) {
  const payload = rows.map((row) => ({
    subdivision: row.subdivision,
    total_listings: row.totalListings,
    business_owner_count: row.businessOwners,
    individual_owner_count: row.individualOwners,
    updated_at: refreshedAt,
  }));

  const { error: deleteError } = await supabase
    .from('listing_subdivision_metrics')
    .delete()
    .neq('subdivision', '');
  if (deleteError) {
    throw deleteError;
  }

  if (payload.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('listing_subdivision_metrics').insert(payload);
  if (insertError) {
    throw insertError;
  }
}

async function writeZoningMetrics(supabase, rows, refreshedAt) {
  const payload = rows.map((row) => ({
    zoning_district: row.zoningDistrict,
    total_listings: row.totalListings,
    business_owner_count: row.businessOwners,
    individual_owner_count: row.individualOwners,
    updated_at: refreshedAt,
  }));

  const { error: deleteError } = await supabase
    .from('listing_zoning_metrics')
    .delete()
    .neq('zoning_district', '');
  if (deleteError) {
    throw deleteError;
  }

  if (payload.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('listing_zoning_metrics').insert(payload);
  if (insertError) {
    throw insertError;
  }
}

async function writeLandUseMetrics(supabase, rows, refreshedAt) {
  const payload = rows.map((row) => ({
    land_use_category: row.landUseCategory,
    total_listings: row.totalListings,
    business_owner_count: row.businessOwners,
    individual_owner_count: row.individualOwners,
    updated_at: refreshedAt,
  }));

  const { error: deleteError } = await supabase
    .from('listing_land_use_metrics')
    .delete()
    .neq('land_use_category', '');
  if (deleteError) {
    throw deleteError;
  }

  if (payload.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('listing_land_use_metrics').insert(payload);
  if (insertError) {
    throw insertError;
  }
}

async function applyOverlayEnhancements(supabase, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return 0;
  }

  const chunkSize = 200;
  let applied = 0;

  for (let index = 0; index < updates.length; index += chunkSize) {
    const chunk = updates.slice(index, index + chunkSize);
    const { error } = await supabase.from('listings').upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw error;
    }
    applied += chunk.length;
  }

  return applied;
}

async function writeRenewalTimeline(supabase, rows, refreshedAt) {
  const payload = rows.map((row) => ({
    renewal_month: row.month,
    listing_count: row.count,
    earliest_renewal: row.earliest,
    latest_renewal: row.latest,
    updated_at: refreshedAt,
  }));

  const { error: deleteError } = await supabase
    .from('listing_renewal_metrics')
    .delete()
    .neq('renewal_month', '1900-01-01');
  if (deleteError) {
    throw deleteError;
  }

  if (payload.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('listing_renewal_metrics').insert(payload);
  if (insertError) {
    throw insertError;
  }
}

async function writeRenewalSummary(supabase, rows, refreshedAt) {
  const payload = rows.map((row) => ({
    category: row.category,
    listing_count: row.count,
    window_start: row.windowStart,
    window_end: row.windowEnd,
    updated_at: refreshedAt,
  }));

  const { error: deleteError } = await supabase
    .from('listing_renewal_summary')
    .delete()
    .neq('category', '__placeholder__');
  if (deleteError) {
    throw deleteError;
  }

  if (payload.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('listing_renewal_summary').insert(payload);
  if (insertError) {
    throw insertError;
  }
}

async function writeRenewalMethodSummary(supabase, rows, refreshedAt) {
  const payload = rows.map((row) => ({
    method: row.method,
    listing_count: row.count,
    updated_at: refreshedAt,
  }));

  const { error: deleteError } = await supabase.from('listing_renewal_method_summary').delete().neq('method', '__placeholder__');
  if (deleteError) {
    throw deleteError;
  }

  if (payload.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('listing_renewal_method_summary').insert(payload);
  if (insertError) {
    throw insertError;
  }
}

export async function refreshListingAggregates(
  supabase,
  options = {},
) {
  const { logger = console, pageSize = PAGE_SIZE } = options;

  logger.info?.('[metrics] Fetching listings dataset…');
  const listings = await fetchListings(supabase, pageSize, logger);
  logger.info?.(`[metrics] Loaded ${listings.length.toLocaleString()} listing records.`);

  const subdivisions = new Map();
  const zoningDistricts = new Map();
  const landUseCategories = new Map();
  const renewalBuckets = new Map();
  const methodCounts = new Map();
  const summary = {
    overdue: { count: 0, windowStart: null, windowEnd: null },
    due_30: { count: 0, windowStart: null, windowEnd: null },
    due_60: { count: 0, windowStart: null, windowEnd: null },
    due_90: { count: 0, windowStart: null, windowEnd: null },
    future: { count: 0, windowStart: null, windowEnd: null },
    missing: { count: 0, windowStart: null, windowEnd: null },
  };

  const overlayUpdates = [];

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

  for (const listing of listings) {
    const subdivision = normaliseSubdivision(listing.subdivision);
    const stats = subdivisions.get(subdivision) || { total: 0, business: 0 };
    stats.total += 1;
    if (listing.is_business_owner) {
      stats.business += 1;
    }
    subdivisions.set(subdivision, stats);

    const overlay = deriveOverlayAttributes(listing);
    const zoningKey = normaliseZoningDistrict(overlay.zoningDistrict);
    const zoningStats = zoningDistricts.get(zoningKey) || { total: 0, business: 0 };
    zoningStats.total += 1;
    if (listing.is_business_owner) {
      zoningStats.business += 1;
    }
    zoningDistricts.set(zoningKey, zoningStats);

    const landUseKey = normaliseLandUseCategory(overlay.landUseCategory);
    const landUseStats = landUseCategories.get(landUseKey) || { total: 0, business: 0 };
    landUseStats.total += 1;
    if (listing.is_business_owner) {
      landUseStats.business += 1;
    }
    landUseCategories.set(landUseKey, landUseStats);

    const update = { id: listing.id };
    let hasOverlayChange = false;

    if (overlay.zoningDistrict && overlay.zoningDistrict !== overlay.existingZoningDistrict) {
      update.zoning_district = overlay.zoningDistrict;
      hasOverlayChange = true;
    }

    if (overlay.zoningDescription && overlay.zoningDescription !== overlay.existingZoningDescription) {
      update.zoning_description = overlay.zoningDescription;
      hasOverlayChange = true;
    }

    if (overlay.landUseCategory && overlay.landUseCategory !== overlay.existingLandUseCategory) {
      update.land_use_category = overlay.landUseCategory;
      hasOverlayChange = true;
    }

    if (overlay.landUseDescription && overlay.landUseDescription !== overlay.existingLandUseDescription) {
      update.land_use_description = overlay.landUseDescription;
      hasOverlayChange = true;
    }

    if (hasOverlayChange) {
      overlayUpdates.push(update);
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
      continue;
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
  }

  const subdivisionRows = Array.from(subdivisions.entries())
    .map(([subdivision, stats]) => ({
      subdivision,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.total - stats.business,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));

  const zoningRows = Array.from(zoningDistricts.entries())
    .map(([zoningDistrict, stats]) => ({
      zoningDistrict,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.total - stats.business,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.zoningDistrict.localeCompare(b.zoningDistrict));

  const landUseRows = Array.from(landUseCategories.entries())
    .map(([landUseCategory, stats]) => ({
      landUseCategory,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.total - stats.business,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.landUseCategory.localeCompare(b.landUseCategory));

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

  const refreshedAt = new Date().toISOString();

  let overlaysApplied = 0;
  if (overlayUpdates.length > 0) {
    logger.info?.(
      `[metrics] Applying overlay attributes to ${overlayUpdates.length.toLocaleString()} listings…`,
    );
    overlaysApplied = await applyOverlayEnhancements(supabase, overlayUpdates);
    logger.info?.(
      `[metrics] Overlay attributes applied to ${overlaysApplied.toLocaleString()} listings.`,
    );
  }

  logger.info?.('[metrics] Writing subdivision metrics…');
  await writeSubdivisionMetrics(supabase, subdivisionRows, refreshedAt);
  logger.info?.('[metrics] Writing zoning metrics…');
  await writeZoningMetrics(supabase, zoningRows, refreshedAt);
  logger.info?.('[metrics] Writing land-use metrics…');
  await writeLandUseMetrics(supabase, landUseRows, refreshedAt);
  logger.info?.('[metrics] Writing renewal timeline…');
  await writeRenewalTimeline(supabase, renewalRows, refreshedAt);
  logger.info?.('[metrics] Writing renewal summary…');
  await writeRenewalSummary(supabase, summaryRows, refreshedAt);
  logger.info?.('[metrics] Writing renewal estimation methods…');
  await writeRenewalMethodSummary(supabase, methodRows, refreshedAt);

  logger.info?.('[metrics] Aggregates refreshed successfully.');

  const totalBusinessOwners = subdivisionRows.reduce((sum, row) => sum + row.businessOwners, 0);
  const totalIndividualOwners = subdivisionRows.reduce((sum, row) => sum + row.individualOwners, 0);

  return {
    refreshedAt,
    listingsProcessed: listings.length,
    subdivisionsWritten: subdivisionRows.length,
    zoningDistrictsWritten: zoningRows.length,
    landUseCategoriesWritten: landUseRows.length,
    renewalTimelineBuckets: renewalRows.length,
    renewalSummaryBuckets: summaryRows.length,
    renewalMethodBuckets: methodRows.length,
    totalBusinessOwners,
    totalIndividualOwners,
    listingsEnhanced: overlaysApplied,
  };
}

export { collectRenewalSignals, estimateRenewal, parseDateValue };
