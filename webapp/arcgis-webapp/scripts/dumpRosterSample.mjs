#!/usr/bin/env node

/**
 * Minimal helper that fetches the Summit County STR roster layer,
 * prints high-level stats, then dumps a few sample rows.
 */

import process from 'node:process';

const DEFAULT_LAYER_URL =
  'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';

const layerUrl = (process.env.SUMMIT_STR_LAYER_URL ?? DEFAULT_LAYER_URL).replace(/\/+$/, '');
const scheduleField = process.env.SUMMIT_SCHEDULE_FIELD ?? 'HC_RegistrationsOriginalCleaned';
const licenseField = process.env.SUMMIT_LICENSE_FIELD ?? 'HC_RegistrationsOriginalClean_1';
const statusField = process.env.SUMMIT_STATUS_FIELD ?? 'HC_RegistrationsOriginalClea_43';
const sampleSize = Number.parseInt(process.env.SUMMIT_ROSTER_SAMPLE ?? '5', 10);
const pageSize = Number.parseInt(process.env.SUMMIT_ROSTER_PAGE_SIZE ?? '1000', 10);

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

function normaliseStatus(raw) {
  if (raw === null || raw === undefined) {
    return 'unknown';
  }
  const text = String(raw).trim();
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

function formatSchedule(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = String(raw).trim();
  return text ? text.toUpperCase() : null;
}

async function fetchPage(offset) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: '*',
    returnGeometry: 'false',
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
  });

  const response = await fetch(`${layerUrl}/query?${params.toString()}`, {
    headers: {
      Referer:
        process.env.SUMMIT_ARCGIS_REFERER ??
        'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/',
      'User-Agent': 'municipal-roster-sample/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`ArcGIS request failed (${response.status}) ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error?.message ?? 'ArcGIS reported an error');
  }
  return payload;
}

async function fetchAllFeatures() {
  const features = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset);
    const pageFeatures = Array.isArray(page.features) ? page.features : [];
    features.push(
      ...pageFeatures.map((feature) => ({
        attributes: feature?.attributes ?? {},
      })),
    );
    offset += pageFeatures.length;

    if (!page.exceededTransferLimit || pageFeatures.length === 0) {
      break;
    }
  }

  return features;
}

function summariseRecords(records) {
  const statusCounts = new Map();
  for (const record of records) {
    const status = normaliseStatus(record.attributes?.[statusField]);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  return statusCounts;
}

function printSummary(records) {
  console.log(`Fetched ${records.length.toLocaleString()} roster entries from ${layerUrl}`);

  const statusCounts = summariseRecords(records);
  console.log('Status counts:');
  for (const [status, count] of Array.from(statusCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(10)} ${count.toLocaleString()}`);
  }

  const sampleRows = records.slice(0, Math.max(0, sampleSize));
  if (sampleRows.length === 0) {
    console.log('No sample data available.');
    return;
  }

  console.log(`\nSample (${sampleRows.length}) entries:`);
  const printable = sampleRows.map((record) => {
    const attrs = record.attributes ?? {};
    return {
      schedule: formatSchedule(attrs[scheduleField]) ?? 'n/a',
      license_id: attrs[licenseField] ?? 'n/a',
      status: attrs[statusField] ?? 'n/a',
      normalized_status: normaliseStatus(attrs[statusField]),
    };
  });
  console.table(printable);
}

async function main() {
  try {
    const records = await fetchAllFeatures();
    printSummary(records);
  } catch (error) {
    console.error('Failed to fetch roster sample:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();
