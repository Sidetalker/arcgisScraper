#!/usr/bin/env node

/**
 * Generic helper to inspect ArcGIS FeatureServer layers.
 *
 * Defaults to the Summit County PVA layer but accepts env overrides:
 *  - FEATURE_LAYER_URL: Base FeatureServer URL (optionally including a layer id)
 *  - FEATURE_LAYER_START_INDEX: Starting layer index when URL omits it (default 0)
 *  - FEATURE_LAYER_SAMPLE: Number of sample features per layer (default 5)
 *  - FEATURE_LAYER_SAMPLE_FIELDS: Comma-separated attribute keys to display
 *  - FEATURE_LAYER_WHERE: Custom WHERE clause for queries (default 1=1)
 *
 * The script walks sequential layer ids until a metadata request fails.
 */

import process from 'node:process';

const DEFAULT_SERVICE_URL =
  'https://services3.arcgis.com/3Ukh5HzAdI6WZ3KP/arcgis/rest/services/PVA_2025_WFL1/FeatureServer';

const {
  serviceUrl,
  startIndex,
} = resolveServiceUrl(process.env.FEATURE_LAYER_URL ?? DEFAULT_SERVICE_URL);

const sampleSize = Math.max(1, Number.parseInt(process.env.FEATURE_LAYER_SAMPLE ?? '5', 10));
const whereClause = process.env.FEATURE_LAYER_WHERE ?? '1=1';
const sampleFields = (process.env.FEATURE_LAYER_SAMPLE_FIELDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const maxLayersToInspect = Math.max(
  1,
  Number.parseInt(process.env.FEATURE_LAYER_MAX_LAYERS ?? '50', 10),
);

const HEADERS = {
  Referer:
    process.env.SUMMIT_ARCGIS_REFERER ??
    'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/',
  'User-Agent': 'feature-layer-sample/1.1',
};

function resolveServiceUrl(url) {
  const trimmed = url.replace(/\/+$/, '');
  const match = trimmed.match(/^(.*\/FeatureServer)(?:\/(\d+))?$/i);
  if (match) {
    return {
      serviceUrl: match[1],
      startIndex: Number.parseInt(
        match[2] ?? process.env.FEATURE_LAYER_START_INDEX ?? '0',
        10,
      ),
    };
  }

  return {
    serviceUrl: trimmed,
    startIndex: Number.parseInt(process.env.FEATURE_LAYER_START_INDEX ?? '0', 10),
  };
}

async function fetchJson(url, params) {
  const query = params ? params.toString() : '';
  const fullUrl = query ? `${url}?${query}` : url;
  const response = await fetch(fullUrl, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Request to ${fullUrl} failed (${response.status}) ${response.statusText}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error?.message ?? 'ArcGIS returned an error');
  }
  return payload;
}

async function fetchLayerMetadata(layerUrl) {
  return fetchJson(layerUrl, new URLSearchParams({ f: 'json' }));
}

async function fetchFeatureCount(layerUrl) {
  const params = new URLSearchParams({
    f: 'json',
    where: whereClause,
    returnCountOnly: 'true',
  });
  const payload = await fetchJson(`${layerUrl}/query`, params);
  return Number(payload.count ?? 0);
}

async function fetchSampleFeatures(layerUrl) {
  const params = new URLSearchParams({
    f: 'json',
    where: whereClause,
    outFields: '*',
    orderByFields: 'OBJECTID',
    resultOffset: '0',
    resultRecordCount: String(sampleSize),
    returnGeometry: 'false',
  });
  const payload = await fetchJson(`${layerUrl}/query`, params);
  return Array.isArray(payload.features)
    ? payload.features.map((feature) => feature?.attributes ?? {})
    : [];
}

function describeFields(fields = [], limit = 10) {
  const preview = fields.slice(0, limit).map((field) => ({
    name: field?.name ?? 'unknown',
    alias: field?.alias ?? '',
    type: field?.type ?? '',
  }));
  console.log(`Fields (${fields.length} total, showing ${preview.length}):`);
  console.table(preview);
  if (fields.length > preview.length) {
    console.log(`…and ${fields.length - preview.length} more fields.`);
  }
}

function pickAttributes(record) {
  if (sampleFields.length > 0) {
    const subset = {};
    for (const field of sampleFields) {
      subset[field] = record[field] ?? null;
    }
    return subset;
  }

  const output = {};
  const entries = Object.entries(record);
  for (let index = 0; index < entries.length && index < 8; index += 1) {
    const [key, value] = entries[index];
    output[key] = value;
  }
  return output;
}

function printSamples(records) {
  if (records.length === 0) {
    console.log('No sample records returned.');
    return;
  }
  console.log(`Sample (${records.length}) records:`);
  console.table(records.map((record) => pickAttributes(record)));
}

async function inspectLayer(layerIndex) {
  const layerUrl = `${serviceUrl}/${layerIndex}`;
  console.log(`\n=== Layer ${layerIndex} (${layerUrl}) ===`);

  let metadata;
  try {
    metadata = await fetchLayerMetadata(layerUrl);
  } catch (error) {
    console.warn(
      `Layer ${layerIndex} request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }

  console.log(`Layer: ${metadata.name ?? 'unknown'}`);
  console.log(`Type: ${metadata.type ?? 'Feature Layer'}, Geometry: ${metadata.geometryType ?? 'n/a'}`);

  try {
    const count = await fetchFeatureCount(layerUrl);
    console.log(`Features matching "${whereClause}": ${count.toLocaleString()}`);
  } catch (error) {
    console.warn(
      `Unable to fetch feature count for layer ${layerIndex}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (Array.isArray(metadata.fields)) {
    describeFields(metadata.fields);
  }

  try {
    const samples = await fetchSampleFeatures(layerUrl);
    printSamples(samples);
  } catch (error) {
    console.warn(
      `Unable to fetch sample features for layer ${layerIndex}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return true;
}

async function main() {
  let successes = 0;

  for (let offset = 0; offset < maxLayersToInspect; offset += 1) {
    const layerIndex = startIndex + offset;
    const success = await inspectLayer(layerIndex);
    if (!success) {
      if (successes === 0) {
        console.log(`Layer ${layerIndex} missing; continuing search…`);
        continue;
      }
      console.log(`Stopping after layer ${layerIndex}; subsequent layer request failed.`);
      return;
    }
    successes += 1;
  }

  console.log(
    `Reached inspection limit (${maxLayersToInspect} layers starting at ${startIndex}) without hitting a failure.`,
  );
}

main().catch((error) => {
  console.error('Failed to dump feature layer sample:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
