#!/usr/bin/env node

/**
 * Extracts named neighborhood ranges (layer 11) as GeoJSON.
 *
 * Usage:
 *   node scripts/exportNeighborhoodGeojson.mjs F15 F25 -o ./ranges.geojson
 *
 * Options:
 *   --output, -o   Optional file path for the GeoJSON output (defaults to stdout)
 *   --where        Override the WHERE clause completely (advanced)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_LAYER_URL =
  'https://services3.arcgis.com/3Ukh5HzAdI6WZ3KP/arcgis/rest/services/PVA_2025_WFL1/FeatureServer/11';
const TARGET_LAYER_URL = (process.env.NEIGHBORHOOD_LAYER_URL ?? DEFAULT_LAYER_URL).replace(/\/+$/, '');

const args = process.argv.slice(2);

function printUsage() {
  console.log(`Usage: node ${path.relative(process.cwd(), process.argv[1])} <NEIGHBORHOOD_CODE...> [--output file]`);
  console.log('Example: node scripts/exportNeighborhoodGeojson.mjs F15 F25 -o ./ranges.geojson');
}

function parseArgs(rawArgs) {
  const names = [];
  let outputPath;
  let customWhere;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
    if (token === '--output' || token === '-o') {
      outputPath = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--output=')) {
      outputPath = token.slice('--output='.length);
      continue;
    }
    if (token.startsWith('--where=')) {
      customWhere = token.slice('--where='.length);
      continue;
    }
    if (token === '--where') {
      customWhere = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      console.error(`Unknown option: ${token}`);
      printUsage();
      process.exit(1);
    }

    names.push(token);
  }

  return { names, outputPath, customWhere };
}

const { names: nameArgs, outputPath, customWhere } = parseArgs(args);

const neighborhoodNames = nameArgs.map((name) => String(name).trim()).filter(Boolean);

if (neighborhoodNames.length === 0 && !customWhere) {
  console.error('Provide at least one neighborhood code or a custom WHERE clause.');
  printUsage();
  process.exit(1);
}

function buildWhereClause() {
  if (customWhere) {
    return customWhere;
  }

  const sanitizedValues = neighborhoodNames.map((name) => `'${name.replace(/'/g, "''").toUpperCase()}'`);
  return `NGHBRHDCD IN (${sanitizedValues.join(', ')})`;
}

const whereClause = buildWhereClause();

async function fetchJson(url, params) {
  const fullUrl = `${url}?${params.toString()}`;
  const response = await fetch(fullUrl, {
    headers: {
      Referer:
        process.env.SUMMIT_ARCGIS_REFERER ??
        'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/',
      'User-Agent': 'neighborhood-geojson-export/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`ArcGIS request failed (${response.status}) ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error?.message ?? 'ArcGIS returned an error');
  }
  return payload;
}

async function fetchNeighborhoodFeatures() {
  const pageSize = 1000;
  const features = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      f: 'json',
      where: whereClause,
      outFields: '*',
      outSR: '4326',
      geometryPrecision: '7',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });

    const payload = await fetchJson(`${TARGET_LAYER_URL}/query`, params);
    const pageFeatures = Array.isArray(payload.features) ? payload.features : [];

    for (const feature of pageFeatures) {
      features.push({
        attributes: feature?.attributes ?? {},
        geometry: feature?.geometry ?? null,
      });
    }

    if (!payload.exceededTransferLimit || pageFeatures.length === 0) {
      break;
    }

    offset += pageFeatures.length;
  }

  return features;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function isClockwise(ring) {
  return ringArea(ring) < 0;
}

function arcgisPolygonToGeojson(geometry) {
  if (!geometry || !Array.isArray(geometry.rings) || geometry.rings.length === 0) {
    return null;
  }

  const multipolygon = [];
  let currentPolygon = null;

  for (const ring of geometry.rings) {
    if (!Array.isArray(ring) || ring.length < 3) {
      continue;
    }
    const normalizedRing =
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]];

    if (!currentPolygon || isClockwise(normalizedRing)) {
      currentPolygon = [normalizedRing];
      multipolygon.push(currentPolygon);
    } else {
      currentPolygon.push(normalizedRing);
    }
  }

  if (multipolygon.length === 0) {
    return null;
  }

  if (multipolygon.length === 1) {
    return {
      type: 'Polygon',
      coordinates: multipolygon[0],
    };
  }

  return {
    type: 'MultiPolygon',
    coordinates: multipolygon.map((polygon) => polygon),
  };
}

function toFeature(entry) {
  const geometry = arcgisPolygonToGeojson(entry.geometry);
  return {
    type: 'Feature',
    geometry,
    properties: {
      neighborhoodCode: entry.attributes?.NGHBRHDCD ?? null,
      area: entry.attributes?.Shape__Area ?? null,
      length: entry.attributes?.Shape__Length ?? null,
    },
  };
}

function writeOutput(collection) {
  const payload = `${JSON.stringify(collection, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, payload);
    console.log(`GeoJSON written to ${resolved}`);
  } else {
    process.stdout.write(payload);
  }
}

async function main() {
  console.log(`Querying ${TARGET_LAYER_URL} with WHERE: ${whereClause}`);
  const records = await fetchNeighborhoodFeatures();
  if (records.length === 0) {
    console.warn('No neighborhood ranges matched the provided criteria.');
  }
  const collection = {
    type: 'FeatureCollection',
    features: records.map(toFeature).filter((feature) => feature.geometry !== null),
  };
  writeOutput(collection);
}

main().catch((error) => {
  console.error('Failed to export neighborhood ranges:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
