#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const statusMappings = require('../shared/strLicenseStatus.json');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const sanitizedLine = line.startsWith('export ') ? line.slice('export '.length) : line;
    const separatorIndex = sanitizedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = sanitizedLine.slice(0, separatorIndex).trim();
    if (!key || key in process.env) {
      continue;
    }
    let value = sanitizedLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const envFile of ['.env.local', '.env']) {
  loadEnvFile(path.join(WORKSPACE_ROOT, envFile));
}

const DEFAULT_LAYER_URL =
  'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';
const DEFAULT_REFERER =
  'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/';

const LAYER_URL = (process.env.SUMMIT_STR_LAYER_URL ?? DEFAULT_LAYER_URL).replace(/\/+$/, '');
const SCHEDULE_FIELD = process.env.SUMMIT_SCHEDULE_FIELD ?? 'HC_RegistrationsOriginalCleaned';
const LICENSE_FIELD = process.env.SUMMIT_LICENSE_FIELD ?? 'HC_RegistrationsOriginalClean_1';
const STATUS_FIELD = process.env.SUMMIT_STATUS_FIELD ?? 'HC_RegistrationsOriginalClea_43';
const UPDATED_AT_FIELD = process.env.SUMMIT_UPDATED_AT_FIELD ?? 'EditDate';
const PAGE_SIZE = Number.parseInt(process.env.SUMMIT_ROSTER_PAGE_SIZE ?? '1000', 10);

const STATUS_MAPPINGS = Array.isArray(statusMappings)
  ? statusMappings
      .map((entry) => ({
        match: typeof entry.match === 'string' ? entry.match.toUpperCase() : '',
        status: typeof entry.status === 'string' ? entry.status : 'unknown',
      }))
      .filter((entry) => entry.match.length > 0)
  : [];

function normaliseStatus(value) {
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

function formatRosterKey(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const formatted = value.toString().trim().toUpperCase();
    return formatted.length > 0 ? formatted : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : null;
  }
  return null;
}

function parseRosterTimestamp(value) {
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

async function fetchRosterPage(offset) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: '*',
    returnGeometry: 'false',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });

  const response = await fetch(`${LAYER_URL}/query?${params.toString()}`, {
    headers: {
      Referer: process.env.SUMMIT_ARCGIS_REFERER ?? DEFAULT_REFERER,
      'User-Agent': 'summit-str-license-sync/1.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ArcGIS request failed (${response.status}) ${text}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error?.message ?? 'ArcGIS reported an error');
  }
  return payload;
}

async function fetchRosterFeatures() {
  const features = [];
  let offset = 0;
  let continuePaging = true;

  while (continuePaging) {
    const page = await fetchRosterPage(offset);
    const pageFeatures = Array.isArray(page.features) ? page.features : [];
    features.push(
      ...pageFeatures.map((feature) => ({ attributes: feature?.attributes ?? {} })),
    );
    offset += pageFeatures.length;

    if (!page.exceededTransferLimit || pageFeatures.length === 0) {
      continuePaging = false;
    }
  }

  return features;
}

function toLicenseRecord(attributes) {
  const rosterKey = formatRosterKey(attributes?.[SCHEDULE_FIELD]);
  if (!rosterKey) {
    return null;
  }
  const licenseIdRaw = attributes?.[LICENSE_FIELD];
  const statusRaw = attributes?.[STATUS_FIELD];
  const updatedAtRaw =
    attributes?.[UPDATED_AT_FIELD] ?? attributes?.EditDate ?? attributes?.editDate ?? null;

  const licenseId =
    typeof licenseIdRaw === 'string' && licenseIdRaw.trim().length > 0
      ? licenseIdRaw.trim()
      : null;
  const status =
    typeof statusRaw === 'string' && statusRaw.trim().length > 0 ? statusRaw.trim() : null;
  const normalizedStatus = normaliseStatus(statusRaw);
  const updatedAt = parseRosterTimestamp(updatedAtRaw);

  return { rosterKey, licenseId, status, normalizedStatus, updatedAt };
}

function buildRosterIndex(features) {
  const index = new Map();
  features.forEach((feature) => {
    const record = toLicenseRecord(feature.attributes ?? {});
    if (!record) {
      return;
    }
    if (!index.has(record.rosterKey)) {
      index.set(record.rosterKey, record);
    }
  });
  return index;
}

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
  console.error(
    'Missing Supabase service role key. Provide SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).',
  );
  process.exit(1);
}

console.info(`Connecting to Supabase project at ${SUPABASE_URL}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchSupabaseListings() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  let hasMore = true;

  while (hasMore) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('listings')
      .select(
        'id, schedule_number, raw, str_license_id, str_license_status, str_license_status_normalized, str_license_updated_at',
      )
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return rows;
}

function resolveListingRosterKey(listing) {
  const raw = (listing.raw ?? {}) || {};
  const rawKey = raw[SCHEDULE_FIELD] ?? listing.schedule_number ?? listing.id;
  return formatRosterKey(rawKey);
}

function parseExistingTimestamp(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildUpdates(listings, rosterIndex) {
  const updates = [];
  let matched = 0;

  listings.forEach((listing) => {
    const rosterKey = resolveListingRosterKey(listing);
    const licenseRecord = rosterKey ? rosterIndex.get(rosterKey) ?? null : null;

    if (licenseRecord) {
      matched += 1;
    }

    const desiredId = licenseRecord?.licenseId ?? null;
    const desiredStatus = licenseRecord?.status ?? null;
    const desiredNormalized = licenseRecord?.normalizedStatus ?? 'unknown';
    const desiredUpdatedAt = licenseRecord?.updatedAt
      ? licenseRecord.updatedAt.toISOString()
      : null;

    const currentId = typeof listing.str_license_id === 'string' ? listing.str_license_id : null;
    const currentStatus =
      typeof listing.str_license_status === 'string' ? listing.str_license_status : null;
    const currentNormalized = normaliseStatus(
      listing.str_license_status_normalized ?? listing.str_license_status ?? null,
    );
    const currentUpdatedAt = parseExistingTimestamp(listing.str_license_updated_at);
    const currentUpdatedAtIso = currentUpdatedAt ? currentUpdatedAt.toISOString() : null;

    if (
      currentId === desiredId &&
      currentStatus === desiredStatus &&
      currentNormalized === desiredNormalized &&
      currentUpdatedAtIso === desiredUpdatedAt
    ) {
      return;
    }

    updates.push({
      id: listing.id,
      str_license_id: desiredId,
      str_license_status: desiredStatus,
      str_license_status_normalized: desiredNormalized,
      str_license_updated_at: desiredUpdatedAt,
    });
  });

  return { updates, matched };
}

async function applyUpdates(updates) {
  if (updates.length === 0) {
    return;
  }

  const chunkSize = 500;
  for (let start = 0; start < updates.length; start += chunkSize) {
    const chunk = updates.slice(start, start + chunkSize);
    const { error } = await supabase.from('listings').upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw error;
    }
  }
}

async function main() {
  console.info('Fetching STR license roster from ArcGIS...');
  const rosterFeatures = await fetchRosterFeatures();
  console.info(`Fetched ${rosterFeatures.length.toLocaleString()} license roster entries.`);
  const rosterIndex = buildRosterIndex(rosterFeatures);

  console.info('Loading existing listings from Supabase...');
  const listings = await fetchSupabaseListings();
  console.info(`Loaded ${listings.length.toLocaleString()} listings from Supabase.`);

  const { updates, matched } = buildUpdates(listings, rosterIndex);
  console.info(
    `Prepared ${updates.length.toLocaleString()} listing update${updates.length === 1 ? '' : 's'} (${matched.toLocaleString()} matched to license records).`,
  );

  await applyUpdates(updates);
  console.info('Supabase STR license fields updated successfully.');
}

main().catch((error) => {
  console.error('Failed to refresh STR license metadata:', error);
  process.exitCode = 1;
});
