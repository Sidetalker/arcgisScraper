import fs from 'node:fs';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

function loadEnvFile(filename, { override = false } = {}) {
  const envPath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!override && process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}

// Load the default env file first, then allow local overrides.
loadEnvFile('.env');
loadEnvFile('.env.local', { override: true });

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_PROJECT_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL) {
  console.error('Missing Supabase URL. Provide SUPABASE_URL (or VITE_/NEXT_PUBLIC_ variants).');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase service role key. Provide SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const PAGE_SIZE = 1000;

function normaliseSubdivision(value) {
  if (!value || typeof value !== 'string') {
    return 'Unknown subdivision';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Unknown subdivision';
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
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
    // ArcGIS often stores timestamps in milliseconds since epoch.
    if (value > 1e12) {
      return new Date(value);
    }
    if (value > 1e9) {
      return new Date(value * 1000);
    }
    // Treat smaller numbers as days offset from 1970-01-01.
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

function extractRenewalDate(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const normalisedEntries = Object.entries(raw).map(([key, value]) => [
    typeof key === 'string' ? key.toLowerCase().replace(/[^a-z0-9]/g, '') : '',
    value,
  ]);

  const preferredKeys = new Map([
    ['licenseexpiration', 'licenseexpiration'],
    ['licenseexpires', 'licenseexpires'],
    ['licexpdate', 'licexpdate'],
    ['licexpir', 'licexpir'],
    ['expirationdate', 'expirationdate'],
    ['expiration', 'expiration'],
    ['expirydate', 'expirydate'],
    ['expdate', 'expdate'],
    ['renewaldate', 'renewaldate'],
    ['licenserenewaldate', 'licenserenewaldate'],
    ['licenserenewal', 'licenserenewal'],
    ['renewaldeadline', 'renewaldeadline'],
    ['renewal', 'renewal'],
  ]);

  for (const [key, value] of normalisedEntries) {
    if (preferredKeys.has(key)) {
      const parsed = parseDateValue(value);
      if (parsed) {
        return parsed;
      }
    }
  }

  for (const [key, value] of normalisedEntries) {
    if (!key) {
      continue;
    }
    if (key.includes('renew') || key.includes('expir')) {
      const parsed = parseDateValue(value);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

async function fetchListings() {
  const listings = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('listings')
      .select('id, subdivision, is_business_owner, raw')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    listings.push(...rows);

    if (rows.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return listings;
}

async function writeSubdivisionMetrics(rows, refreshedAt) {
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

async function writeRenewalTimeline(rows, refreshedAt) {
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

async function writeRenewalSummary(rows, refreshedAt) {
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

async function main() {
  console.info('[metrics] Fetching listings dataset…');
  const listings = await fetchListings();
  console.info(`[metrics] Loaded ${listings.length.toLocaleString()} listing records.`);

  const subdivisions = new Map();
  const renewalBuckets = new Map();
  const summary = {
    overdue: { count: 0, windowStart: null, windowEnd: null },
    due_30: { count: 0, windowStart: null, windowEnd: null },
    due_60: { count: 0, windowStart: null, windowEnd: null },
    due_90: { count: 0, windowStart: null, windowEnd: null },
    future: { count: 0, windowStart: null, windowEnd: null },
    missing: { count: 0, windowStart: null, windowEnd: null },
  };

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
    const subdivision = normaliseSubdivision(listing.subdivision);
    const stats = subdivisions.get(subdivision) || { total: 0, business: 0 };
    stats.total += 1;
    if (listing.is_business_owner) {
      stats.business += 1;
    }
    subdivisions.set(subdivision, stats);

    const renewalDate = extractRenewalDate(listing.raw);
    if (!renewalDate) {
      summary.missing.count += 1;
      return;
    }

    const bucketKey = formatDate(new Date(Date.UTC(renewalDate.getUTCFullYear(), renewalDate.getUTCMonth(), 1)));
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
      return;
    }
    if (renewalDate <= in30) {
      summary.due_30.count += 1;
      return;
    }
    if (renewalDate <= in60) {
      summary.due_60.count += 1;
      return;
    }
    if (renewalDate <= in90) {
      summary.due_90.count += 1;
      return;
    }
    summary.future.count += 1;
  });

  const subdivisionRows = Array.from(subdivisions.entries())
    .map(([subdivision, stats]) => ({
      subdivision,
      totalListings: stats.total,
      businessOwners: stats.business,
      individualOwners: stats.total - stats.business,
    }))
    .sort((a, b) => b.totalListings - a.totalListings || a.subdivision.localeCompare(b.subdivision));

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

  const refreshedAt = new Date().toISOString();

  console.info('[metrics] Writing subdivision metrics…');
  await writeSubdivisionMetrics(subdivisionRows, refreshedAt);
  console.info('[metrics] Writing renewal timeline…');
  await writeRenewalTimeline(renewalRows, refreshedAt);
  console.info('[metrics] Writing renewal summary…');
  await writeRenewalSummary(summaryRows, refreshedAt);

  console.info('[metrics] Aggregates refreshed successfully.');
}

main().catch((error) => {
  console.error('[metrics] Failed to refresh aggregates:', error);
  process.exitCode = 1;
});
