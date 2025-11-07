#!/usr/bin/env node

/**
 * Imports owner contact overrides from a spreadsheet export and persists them in Supabase.
 *
 * Expected spreadsheet layout (one complex per section):
 *   Complex Name,Owner(s),Mailing address,Mailing city,State,ZIP
 *   Unit,Owner 1; Owner 2,"Street, City, ST 12345-6789",City,ST,12345-6789
 */

import fs from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const COMPLEX_SUFFIXES = new Set([
  'assoc',
  'association',
  'condo',
  'condos',
  'condominium',
  'condominiums',
  'hoa',
  'sub',
  'subdivision',
  'townhome',
  'townhomes',
  'townhouse',
  'townhouses',
]);

function parseArgs(argv) {
  const options = {
    input: null,
    apply: false,
    allowPartial: false,
    watchlistName: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
      case '-i': {
        const value = argv[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error('Missing value for --input');
        }
        options.input = value;
        index += 1;
        break;
      }
      case '--apply': {
        options.apply = true;
        break;
      }
      case '--allow-partial': {
        options.allowPartial = true;
        break;
      }
      case '--watchlist-name': {
        const value = argv[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error('Missing value for --watchlist-name');
        }
        if (options.watchlistName) {
          throw new Error('Specify --watchlist-name only once.');
        }
        options.watchlistName = value;
        index += 1;
        break;
      }
      case '--help':
      case '-h': {
        printUsage();
        process.exit(0);
      }
      default: {
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
      }
    }
  }

  if (!options.input) {
    throw new Error('Specify --input <path-to-csv> with the spreadsheet export.');
  }

  if (options.watchlistName && options.watchlistName.trim().length === 0) {
    throw new Error('--watchlist-name cannot be empty.');
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/applySpreadsheetOverrides.mjs --input path/to/file.csv [--apply] [--allow-partial] [--watchlist-name "Name"]

Options:
  --input, -i        Path to the CSV export from the spreadsheet (required)
  --apply            Persist overrides to Supabase (omit for a dry-run preview)
  --allow-partial    Allow updates even if some rows failed to match listings
  --watchlist-name   Create a new watchlist with the matched listing IDs
  --help, -h         Show this help message`);
}

function parseCsv(content) {
  const rows = [];
  const currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  const flushValue = () => {
    currentRow.push(currentValue);
    currentValue = '';
  };

  const flushRow = () => {
    flushValue();
    rows.push([...currentRow]);
    currentRow.length = 0;
  };

  const length = content.length;
  for (let index = 0; index < length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        const nextChar = content[index + 1];
        if (nextChar === '"') {
          currentValue += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      currentValue += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      flushValue();
      continue;
    }

    if (char === '\r') {
      continue;
    }

    if (char === '\n') {
      flushRow();
      continue;
    }

    currentValue += char;
  }

  flushRow();
  return rows;
}

function parseOwnerNames(input) {
  return input
    .split(/\r?\n|;/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function normaliseZipParts(input) {
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length >= 9) {
    const zip5 = digits.slice(0, 5);
    const plus4 = digits.slice(5, 9);
    return { zip5, zip9: `${zip5}-${plus4}` };
  }
  if (digits.length >= 5) {
    const zip5 = digits.slice(0, 5);
    return { zip5, zip9: '' };
  }
  return { zip5: digits, zip9: '' };
}

function normaliseAddressComponent(value) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim().toLowerCase();
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMailingAddressKey(line1, line2, city, state, zip) {
  const parts = [
    normaliseAddressComponent(line1),
    normaliseAddressComponent(line2),
    normaliseAddressComponent(city),
    normaliseAddressComponent(state),
    normaliseAddressComponent(zip),
  ].filter((part) => part.length > 0);
  return parts.join('|');
}

function formatCityStateZipLine(city, state, zip) {
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = zip.trim();

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

function composeMailingAddressText(line1, line2, city, state, zip) {
  const lines = [];
  const trimmedLine1 = line1.trim();
  const trimmedLine2 = line2.trim();

  if (trimmedLine1) {
    lines.push(trimmedLine1);
  }

  if (trimmedLine2) {
    trimmedLine2
      .split(/\r?\n/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => lines.push(segment));
  }

  const cityLine = formatCityStateZipLine(city, state, zip);
  if (cityLine) {
    lines.push(cityLine);
  }

  return lines.join('\n');
}

function parseMailingAddress(rawAddress, city, state, zip) {
  const prepared = rawAddress.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const segments = prepared
    ? prepared
        .split(',')
        .map((segment) => segment.trim())
        .filter(Boolean)
    : [];

  const trimmedCity = city.trim();
  const trimmedState = state.trim();
  const trimmedZip = zip.trim();

  let derivedCity = trimmedCity;
  let derivedState = trimmedState;
  let derivedZip = trimmedZip;

  let working = [...segments];

  if (derivedState) {
    const normalizedState = derivedState.toLowerCase();
    const last = working[working.length - 1]?.toLowerCase() ?? '';
    if (last === normalizedState || last.startsWith(`${normalizedState} `)) {
      working = working.slice(0, -1);
    }
  } else if (working.length > 0) {
    const lastSegment = working[working.length - 1];
    const tokens = lastSegment.split(/\s+/).filter(Boolean);
    if (tokens.length >= 1 && tokens[0].length <= 3) {
      derivedState = tokens[0].toUpperCase();
      if (!derivedZip && tokens.length > 1) {
        derivedZip = tokens.slice(1).join(' ');
      }
      working = working.slice(0, -1);
    }
  }

  if (derivedCity) {
    const normalizedCity = derivedCity.toLowerCase();
    const last = working[working.length - 1]?.toLowerCase() ?? '';
    if (last === normalizedCity) {
      working = working.slice(0, -1);
    }
  } else if (working.length > 0) {
    derivedCity = working[working.length - 1];
    working = working.slice(0, -1);
  }

  const line1 = working[0] ?? '';
  const line2 = working.slice(1).join(', ');

  return {
    line1,
    line2,
    city: derivedCity,
    state: derivedState,
    zip: derivedZip,
  };
}

function normaliseComplexName(value) {
  if (!value) {
    return '';
  }
  const cleaned = value.replace(/&/g, ' and ').replace(/[^a-z0-9\s]/gi, ' ').toLowerCase();
  if (!cleaned.trim()) {
    return '';
  }

  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => {
      if (COMPLEX_SUFFIXES.has(token)) {
        return false;
      }
      if (token.endsWith('s')) {
        const singular = token.slice(0, -1);
        if (COMPLEX_SUFFIXES.has(singular)) {
          return false;
        }
      }
      return true;
    });

  return tokens.join(' ').trim();
}

function normaliseUnit(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function addVariantWeight(map, key, weight) {
  if (!key) {
    return;
  }
  const existing = map.get(key);
  if (existing === undefined || weight < existing) {
    map.set(key, weight);
  }
}

function addUnitBreakdowns(map, normalized, weight) {
  if (!normalized) {
    return;
  }
  const segments = normalized.match(/[a-z]+|\d+/g);
  if (!segments || segments.length <= 1) {
    return;
  }
  const breakdownWeight = weight + 2;
  segments.forEach((segment) => {
    addVariantWeight(map, segment, breakdownWeight);
  });
  for (let index = 0; index < segments.length - 1; index += 1) {
    addVariantWeight(map, segments[index] + segments[index + 1], breakdownWeight);
  }
}

function collectUnitVariantWeights(map, rawValue, baseWeight) {
  if (!rawValue) {
    return;
  }
  const normalized = normaliseUnit(rawValue);
  if (!normalized) {
    return;
  }
  addVariantWeight(map, normalized, baseWeight);
  addUnitBreakdowns(map, normalized, baseWeight + 1);
}

function extractUnitsFromPhysicalAddress(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  const units = new Set();
  const search = value.replace(/\r\n/g, ' ');

  const unitPattern =
    /\b(?:unit|apt|apartment|suite|ste)\s+([A-Za-z0-9]+)(?:\s*[-/#]?\s*([A-Za-z0-9]+))?/gi;
  let match = unitPattern.exec(search);
  while (match) {
    const first = match[1]?.trim();
    const second = match[2]?.trim();
    if (first) {
      units.add(first);
    }
    if (second) {
      units.add(second);
    }
    if (first && second) {
      units.add(`${first}${second}`);
    }
    match = unitPattern.exec(search);
  }

  const hashPattern = /#\s*([A-Za-z0-9]+)/gi;
  match = hashPattern.exec(search);
  while (match) {
    const fragment = match[1]?.trim();
    if (fragment) {
      units.add(fragment);
    }
    match = hashPattern.exec(search);
  }

  return Array.from(units);
}

function buildUnitVariantWeightsFromValue(value, baseWeight = 0) {
  const map = new Map();
  collectUnitVariantWeights(map, value, baseWeight);
  return map;
}

function mergeUnitVariantWeights(target, source, weightOffset = 0) {
  source.forEach((weight, key) => {
    addVariantWeight(target, key, weight + weightOffset);
  });
}

function buildListingUnitVariantWeights(row) {
  const weights = new Map();
  mergeUnitVariantWeights(weights, buildUnitVariantWeightsFromValue(row.unit ?? ''), 0);
  const physicalFragments = extractUnitsFromPhysicalAddress(row.physical_address ?? '');
  physicalFragments.forEach((fragment) => {
    const fragmentWeights = buildUnitVariantWeightsFromValue(fragment, 1);
    mergeUnitVariantWeights(weights, fragmentWeights, 0);
  });
  return weights;
}

function buildSheetUnitVariantWeights(unitValue) {
  return buildUnitVariantWeightsFromValue(unitValue, 0);
}

function normaliseStringValue(value) {
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

function normaliseMultilineValue(value) {
  if (typeof value !== 'string') {
    return normaliseStringValue(value);
  }
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normaliseOwnerNamesValue(value) {
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

function normaliseCustomizationOverrides(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const overrides = {};
  if ('complex' in raw) {
    overrides.complex = normaliseStringValue(raw.complex);
  }
  if ('unit' in raw) {
    overrides.unit = normaliseStringValue(raw.unit);
  }
  if ('ownerName' in raw) {
    overrides.ownerName = normaliseStringValue(raw.ownerName);
  }
  if ('ownerNames' in raw) {
    overrides.ownerNames = normaliseOwnerNamesValue(raw.ownerNames);
  }
  if ('mailingAddress' in raw) {
    overrides.mailingAddress = normaliseMultilineValue(raw.mailingAddress);
  }
  if ('mailingAddressLine1' in raw) {
    overrides.mailingAddressLine1 = normaliseMultilineValue(raw.mailingAddressLine1);
  }
  if ('mailingAddressLine2' in raw) {
    overrides.mailingAddressLine2 = normaliseMultilineValue(raw.mailingAddressLine2);
  }
  if ('mailingCity' in raw) {
    overrides.mailingCity = normaliseStringValue(raw.mailingCity);
  }
  if ('mailingState' in raw) {
    overrides.mailingState = normaliseStringValue(raw.mailingState).toUpperCase();
  }
  if ('mailingZip5' in raw) {
    overrides.mailingZip5 = normaliseStringValue(raw.mailingZip5);
  }
  if ('mailingZip9' in raw) {
    overrides.mailingZip9 = normaliseStringValue(raw.mailingZip9);
  }
  if ('subdivision' in raw) {
    overrides.subdivision = normaliseStringValue(raw.subdivision);
  }
  if ('scheduleNumber' in raw) {
    overrides.scheduleNumber = normaliseStringValue(raw.scheduleNumber);
  }
  if ('physicalAddress' in raw) {
    overrides.physicalAddress = normaliseMultilineValue(raw.physicalAddress);
  }
  if ('isBusinessOwner' in raw) {
    const value = raw.isBusinessOwner;
    overrides.isBusinessOwner = typeof value === 'boolean' ? value : Boolean(value);
  }

  return overrides;
}

function sanitiseOverridesForStorage(overrides) {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  );
}

function cloneOverrides(overrides) {
  return JSON.parse(JSON.stringify(overrides ?? {}));
}

function arrayEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function shallowEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    const valueA = a[key];
    const valueB = b[key];
    if (Array.isArray(valueA) || Array.isArray(valueB)) {
      if (!arrayEqual(valueA, valueB)) {
        return false;
      }
      continue;
    }
    if (valueA !== valueB) {
      return false;
    }
  }
  return true;
}

function normaliseZipForComparison(value) {
  return value.replace(/[^0-9]/g, '').slice(0, 9);
}

function parseSpreadsheetRecords(tableRows) {
  const records = [];
  let currentComplex = '';

  tableRows.forEach((row, index) => {
    const cells = row.map((cell) => (typeof cell === 'string' ? cell.trim() : cell ?? ''));
    if (cells.every((cell) => !cell)) {
      return;
    }

    const [first, second, addressCell = '', cityCell = '', stateCell = '', zipCell = ''] = cells;

    const isHeaderRow = second && second.toLowerCase().startsWith('owner');
    if (isHeaderRow) {
      currentComplex = first ? first.trim() : '';
      return;
    }

    if (!currentComplex) {
      console.warn(
        `Row ${index + 1}: encountered data row before a complex heading, skipping.`,
      );
      return;
    }

    const unit = first ? first.trim() : '';
    if (!unit) {
      console.warn(`Row ${index + 1}: unit column is empty for complex "${currentComplex}".`);
      return;
    }

    const ownerNames = parseOwnerNames(second ?? '');
    const ownerName = ownerNames.join('; ');

    const parsedAddress = parseMailingAddress(addressCell ?? '', cityCell ?? '', stateCell ?? '', zipCell ?? '');
    const mailingCity = (cityCell ?? parsedAddress.city ?? '').trim();
    const mailingState = (stateCell ?? parsedAddress.state ?? '').trim().toUpperCase();

    const { zip5, zip9 } = normaliseZipParts(zipCell ?? parsedAddress.zip ?? '');
    const mailingAddressLine1 = parsedAddress.line1.trim();
    const mailingAddressLine2 = parsedAddress.line2.trim();
    const mailingAddress = composeMailingAddressText(
      mailingAddressLine1,
      mailingAddressLine2,
      mailingCity,
      mailingState,
      zip9 || zip5,
    );

    records.push({
      complex: currentComplex.trim(),
      unit,
      ownerNames,
      ownerName,
      mailingAddress,
      mailingAddressLine1,
      mailingAddressLine2,
      mailingCity,
      mailingState,
      mailingZip5: zip5,
      mailingZip9: zip9,
      mailingAddressKey: buildMailingAddressKey(
        mailingAddressLine1,
        mailingAddressLine2,
        mailingCity,
        mailingState,
        zip9 || zip5,
      ),
      mailingAddressLine1Key: normaliseAddressComponent(mailingAddressLine1),
      sourceRow: index + 1,
    });
  });

  return records;
}

async function fetchAllListings(client) {
  const rows = [];
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from('listings')
      .select(
        [
          'id',
          'complex',
          'subdivision',
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
          'physical_address',
        ].join(', '),
      )
      .order('schedule_number', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }
  return rows;
}

async function fetchListingCustomizations(client) {
  const map = new Map();
  const { data, error } = await client
    .from('listing_customizations')
    .select('listing_id, overrides');

  if (error) {
    throw new Error(`Failed to fetch listing customizations: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  rows.forEach((row) => {
    const normalized = normaliseCustomizationOverrides(row.overrides ?? {});
    map.set(row.listing_id, normalized);
  });

  return map;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
}

function coalesceString(preferred, fallback) {
  if (typeof preferred === 'string') {
    const trimmed = preferred.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } else if (preferred !== null && preferred !== undefined) {
    const stringified = String(preferred).trim();
    if (stringified.length > 0) {
      return stringified;
    }
  }

  if (typeof fallback === 'string') {
    return fallback.trim();
  }
  if (fallback === null || fallback === undefined) {
    return '';
  }
  return String(fallback).trim();
}

function buildListingRecords(listings, overridesById) {
  return listings.map((row) => {
    const existingOverrides = overridesById.get(row.id) ?? {};
    const normalizedComplexes = new Set();
    const complexVariants = [row.complex ?? '', row.subdivision ?? ''];
    complexVariants.forEach((value) => {
      const normalized = normaliseComplexName(value);
      if (normalized) {
        normalizedComplexes.add(normalized);
      }
    });

    const unitVariantWeights = buildListingUnitVariantWeights(row);
    const baseOwnerName = normaliseStringValue(row.owner_name);
    const baseOwnerNames = normaliseOwnerNamesValue(row.owner_names);
    const ownerNamesLower = baseOwnerNames.map((name) => name.toLowerCase());
    const ownerNameLower = baseOwnerName.toLowerCase();
    const mailingAddressKey = buildMailingAddressKey(
      row.mailing_address_line1 ?? '',
      row.mailing_address_line2 ?? '',
      row.mailing_city ?? '',
      row.mailing_state ?? '',
      row.mailing_zip9 ?? row.mailing_zip5 ?? '',
    );
    const mailingAddressLine1Key = normaliseAddressComponent(row.mailing_address_line1 ?? '');

    return {
      id: row.id,
      complex: row.complex ?? '',
      subdivision: row.subdivision ?? '',
      unit: row.unit ?? '',
      normalizedComplexes,
      unitVariantWeights,
      ownerNamesLower,
      ownerNameLower,
      mailingAddressKey,
      mailingAddressLine1Key,
      base: {
        ownerName: baseOwnerName,
        ownerNames: baseOwnerNames,
        mailingAddress: normaliseMultilineValue(row.mailing_address),
        mailingAddressLine1: normaliseMultilineValue(row.mailing_address_line1),
        mailingAddressLine2: normaliseMultilineValue(row.mailing_address_line2),
        mailingCity: normaliseStringValue(row.mailing_city),
        mailingState: normaliseStringValue(row.mailing_state).toUpperCase(),
        mailingZip5: normaliseStringValue(row.mailing_zip5),
        mailingZip9: normaliseStringValue(row.mailing_zip9),
      },
      overrides: cloneOverrides(existingOverrides),
    };
  });
}

function buildListingIndex(listingRecords) {
  const index = new Map();
  listingRecords.forEach((listing) => {
    if (!listing.unitVariantWeights || listing.unitVariantWeights.size === 0) {
      return;
    }
    listing.unitVariantWeights.forEach((weight, unitVariant) => {
      listing.normalizedComplexes.forEach((complexKey) => {
        const key = `${complexKey}||${unitVariant}`;
        const bucket = index.get(key) ?? [];
        bucket.push({ listing, weight });
        index.set(key, bucket);
      });
    });
  });
  return index;
}

function addCandidateEntry(candidateMap, listing, weight) {
  const existing = candidateMap.get(listing.id);
  if (!existing || weight < existing.weight) {
    candidateMap.set(listing.id, { listing, weight });
  }
}

function registerComplexAlias(sheetComplexKey, listing, aliasMap) {
  if (!sheetComplexKey) {
    return;
  }
  if (listing.normalizedComplexes.has(sheetComplexKey)) {
    return;
  }
  const canonical = listing.normalizedComplexes.values().next().value;
  if (canonical && canonical !== sheetComplexKey) {
    aliasMap.set(sheetComplexKey, canonical);
  }
}

function computeMatchScore(listing, sheetRecord, unitWeight, sheetOwnerNamesLower) {
  let score = 0;

  if (Number.isFinite(unitWeight)) {
    score += Math.max(0, 10 - unitWeight * 2);
  }

  if (
    sheetRecord.mailingAddressKey &&
    listing.mailingAddressKey &&
    listing.mailingAddressKey === sheetRecord.mailingAddressKey
  ) {
    score += 8;
  }

  const listingOwnerNamesLower = listing.ownerNamesLower;
  if (sheetOwnerNamesLower.length > 0 && listingOwnerNamesLower.length > 0) {
    const exactOwnerMatch = sheetOwnerNamesLower.some((owner) =>
      listingOwnerNamesLower.includes(owner),
    );
    if (exactOwnerMatch) {
      score += 6;
    } else {
      const fuzzyOwnerMatch = sheetOwnerNamesLower.some((owner) =>
        listingOwnerNamesLower.some(
          (candidate) => candidate.includes(owner) || owner.includes(candidate),
        ),
      );
      if (fuzzyOwnerMatch) {
        score += 3;
      }
    }
  }

  const sheetOwnerName = (sheetRecord.ownerName ?? '').toLowerCase();
  if (sheetOwnerName && listing.ownerNameLower === sheetOwnerName) {
    score += 3;
  }

  if (
    sheetRecord.mailingAddressLine1Key &&
    listing.mailingAddressLine1Key &&
    listing.mailingAddressLine1Key === sheetRecord.mailingAddressLine1Key
  ) {
    score += 3;
  }

  const sheetComplex = normaliseComplexName(sheetRecord.complex);
  if (sheetComplex && listing.normalizedComplexes.has(sheetComplex)) {
    score += 2;
  }

  if (
    sheetRecord.mailingZip5 &&
    normaliseZipForComparison(listing.base.mailingZip5) ===
      normaliseZipForComparison(sheetRecord.mailingZip5)
  ) {
    score += 2;
  }

  if (
    sheetRecord.mailingZip9 &&
    normaliseZipForComparison(listing.base.mailingZip9) ===
      normaliseZipForComparison(sheetRecord.mailingZip9)
  ) {
    score += 1;
  }

  if (
    sheetRecord.mailingCity &&
    listing.base.mailingCity.toLowerCase() === sheetRecord.mailingCity.toLowerCase()
  ) {
    score += 1;
  }

  return score;
}

function computeSupportSignals(
  listing,
  sheetRecord,
  sheetOwnerNamesLower,
  sheetAddressKey,
  sheetLine1Key,
  sheetZip5Key,
  sheetZip9Key,
  sheetCityKey,
) {
  const ownerOverlap = sheetOwnerNamesLower.some((owner) =>
    listing.ownerNamesLower.includes(owner),
  );
  const addressMatch = Boolean(sheetAddressKey && listing.mailingAddressKey === sheetAddressKey);
  const line1Match =
    Boolean(sheetLine1Key && listing.mailingAddressLine1Key === sheetLine1Key);
  const zip5Match =
    Boolean(
      sheetZip5Key &&
        normaliseZipForComparison(listing.base.mailingZip5 ?? '') === sheetZip5Key,
    );
  const zip9Match =
    Boolean(
      sheetZip9Key &&
        normaliseZipForComparison(listing.base.mailingZip9 ?? '') === sheetZip9Key,
    );
  const cityMatch =
    Boolean(
      sheetRecord.mailingCity &&
        listing.base.mailingCity.toLowerCase() === sheetCityKey,
    );

  return {
    ownerOverlap,
    addressMatch,
    line1Match,
    zip5Match,
    zip9Match,
    cityMatch,
    any: ownerOverlap || addressMatch || line1Match || zip5Match || zip9Match || cityMatch,
  };
}

function resolveListing(sheetRecord, listingRecords, listingIndex, complexAliasMap) {
  const complexKey = normaliseComplexName(sheetRecord.complex);
  const complexVariants = new Set();
  if (complexKey) {
    complexVariants.add(complexKey);
    let alias = complexAliasMap.get(complexKey);
    const visited = new Set([complexKey]);
    while (alias && !complexVariants.has(alias) && !visited.has(alias)) {
      complexVariants.add(alias);
      visited.add(alias);
      alias = complexAliasMap.get(alias);
    }
  }
  const sheetUnitVariantWeights = buildSheetUnitVariantWeights(sheetRecord.unit);
  const sheetOwnerNamesLower = sheetRecord.ownerNames
    .map((name) => name.toLowerCase().trim())
    .filter((name) => name.length > 0);
  const sheetAddressKey = sheetRecord.mailingAddressKey;
  const sheetLine1Key = sheetRecord.mailingAddressLine1Key;
  const sheetZip5Key =
    sheetRecord.mailingZip5 ? normaliseZipForComparison(sheetRecord.mailingZip5) : '';
  const sheetZip9Key =
    sheetRecord.mailingZip9 ? normaliseZipForComparison(sheetRecord.mailingZip9) : '';
  const sheetCityKey = (sheetRecord.mailingCity ?? '').toLowerCase();
  const sheetUnitNormalized = normaliseUnit(sheetRecord.unit);

  const candidateMap = new Map();

  complexVariants.forEach((complexVariant) => {
    sheetUnitVariantWeights.forEach((sheetWeight, unitVariant) => {
      const key = `${complexVariant}||${unitVariant}`;
      const entries = listingIndex.get(key);
      if (!entries) {
        return;
      }
      entries.forEach(({ listing, weight: listingWeight }) => {
        const combinedWeight = sheetWeight + listingWeight;
        addCandidateEntry(candidateMap, listing, combinedWeight);
      });
    });
  });

  if (candidateMap.size === 0) {
    listingRecords.forEach((listing) => {
      const matchesComplex =
        complexVariants.size > 0 &&
        (complexKey
          ? listing.normalizedComplexes.has(complexKey) ||
            Array.from(listing.normalizedComplexes).some(
              (value) => value.includes(complexKey) || complexKey.includes(value),
            )
          : false);
      const signals = computeSupportSignals(
        listing,
        sheetRecord,
        sheetOwnerNamesLower,
        sheetAddressKey,
        sheetLine1Key,
        sheetZip5Key,
        sheetZip9Key,
        sheetCityKey,
      );

      let fallbackWeight = null;
      if (signals.addressMatch) {
        fallbackWeight = 1;
      } else if (signals.ownerOverlap && signals.zip9Match) {
        fallbackWeight = 2;
      } else if (signals.ownerOverlap && signals.zip5Match && signals.cityMatch) {
        fallbackWeight = 3;
      } else if (signals.ownerOverlap && signals.line1Match) {
        fallbackWeight = 4;
      } else if (matchesComplex && (signals.zip5Match || signals.ownerOverlap)) {
        fallbackWeight = 5;
      } else if (signals.zip9Match && signals.line1Match) {
        fallbackWeight = 6;
      }

      if (fallbackWeight !== null) {
        addCandidateEntry(candidateMap, listing, fallbackWeight);
      }
    });
  }

  if (candidateMap.size === 0) {
    return { status: 'missing' };
  }

  const candidates = Array.from(candidateMap.values()).map((candidate) => {
    const unitExactMatch =
      Boolean(sheetUnitNormalized) &&
      candidate.listing.unitVariantWeights &&
      candidate.listing.unitVariantWeights.has(sheetUnitNormalized);
    return { ...candidate, unitExactMatch };
  });

  const scored = candidates
    .map((candidate) => ({
      listing: candidate.listing,
      weight: candidate.weight,
      unitExactMatch: candidate.unitExactMatch,
      score: computeMatchScore(
        candidate.listing,
        sheetRecord,
        candidate.weight,
        sheetOwnerNamesLower,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.weight - b.weight);

  let resolved = null;
  if (scored.length === 1 || scored[0].score > (scored[1]?.score ?? -Infinity)) {
    resolved = scored[0];
  } else {
    const unitMatches = scored.filter((entry) => entry.unitExactMatch);
    if (unitMatches.length === 1) {
      resolved = unitMatches[0];
    }
  }

  if (resolved) {
    const signals = computeSupportSignals(
      resolved.listing,
      sheetRecord,
      sheetOwnerNamesLower,
      sheetAddressKey,
      sheetLine1Key,
      sheetZip5Key,
      sheetZip9Key,
      sheetCityKey,
    );
    if (!signals.any) {
      resolved = null;
    }
  }

  if (!resolved && scored.length === 1) {
    resolved = scored[0];
  }

  if (resolved) {
    registerComplexAlias(complexKey, resolved.listing, complexAliasMap);
    return {
      status: 'matched',
      listing: resolved.listing,
      autoResolved: true,
    };
  }

  return {
    status: 'ambiguous',
    candidates: scored.map((entry) => entry.listing),
  };
}

function applyOverrideField({
  key,
  targetValue,
  baseValue,
  overrides,
  comparator,
  summary,
  formatter = (value) => value,
  preserveExistingOnEmpty = false,
}) {
  const hasExisting = Object.prototype.hasOwnProperty.call(overrides, key);
  const existingValue = hasExisting ? overrides[key] : undefined;
  const currentValue = hasExisting ? existingValue : baseValue;
  const normalisedTarget = formatter(targetValue);
  const normalisedBase = formatter(baseValue);
  const normalisedCurrent = formatter(currentValue);
  const targetEmpty = isEmptyValue(normalisedTarget);
  const baseEmpty = isEmptyValue(normalisedBase);

  if (preserveExistingOnEmpty && targetEmpty && !baseEmpty) {
    if (hasExisting) {
      delete overrides[key];
      summary.push({
        field: key,
        action: 'removed',
        from: currentValue,
        to: baseValue,
      });
      return true;
    }
    return false;
  }

  const matchesTarget = comparator(normalisedCurrent, normalisedTarget);

  if (matchesTarget) {
    if (hasExisting && comparator(normalisedBase, normalisedTarget)) {
      delete overrides[key];
      summary.push({
        field: key,
        action: 'removed',
        from: currentValue,
        to: baseValue,
      });
      return true;
    }
    return false;
  }

  if (comparator(normalisedBase, normalisedTarget)) {
    if (hasExisting) {
      delete overrides[key];
      summary.push({
        field: key,
        action: 'removed',
        from: currentValue,
        to: baseValue,
      });
      return true;
    }
    return false;
  }

  overrides[key] = targetValue;
  summary.push({
    field: key,
    action: hasExisting ? 'updated' : 'added',
    from: currentValue,
    to: targetValue,
  });
  return true;
}

function computeOverrideUpdate(listing, sheetRecord) {
  const overrides = cloneOverrides(listing.overrides);
  const summary = [];

  const stringFormatter = (value) =>
    typeof value === 'string' ? value.trim() : value ?? '';
  const multilineFormatter = (value) =>
    typeof value === 'string'
      ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
      : value ?? '';
  const zipFormatter = (value) => normaliseZipForComparison(stringFormatter(value));
  const effectiveMailingZip5 = coalesceString(
    sheetRecord.mailingZip5,
    listing.base.mailingZip5,
  );
  const effectiveMailingZip9 = coalesceString(
    sheetRecord.mailingZip9,
    listing.base.mailingZip9,
  );
  const effectiveMailingCity = coalesceString(
    sheetRecord.mailingCity,
    listing.base.mailingCity,
  );
  const effectiveMailingState = coalesceString(
    sheetRecord.mailingState,
    listing.base.mailingState,
  );
  const effectiveMailingAddressLine1 = coalesceString(
    sheetRecord.mailingAddressLine1,
    listing.base.mailingAddressLine1,
  );
  const effectiveMailingAddressLine2 =
    typeof sheetRecord.mailingAddressLine2 === 'string'
      ? sheetRecord.mailingAddressLine2
      : '';
  const effectiveMailingAddress = composeMailingAddressText(
    effectiveMailingAddressLine1,
    effectiveMailingAddressLine2,
    effectiveMailingCity,
    effectiveMailingState,
    effectiveMailingZip9 || effectiveMailingZip5,
  );

  applyOverrideField({
    key: 'complex',
    targetValue: sheetRecord.complex,
    baseValue: listing.complex,
    overrides,
    comparator: (a, b) => a === b,
    summary,
    formatter: stringFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'unit',
    targetValue: sheetRecord.unit,
    baseValue: listing.unit,
    overrides,
    comparator: (a, b) => a === b,
    summary,
    formatter: stringFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'ownerNames',
    targetValue: sheetRecord.ownerNames,
    baseValue: listing.base.ownerNames,
    overrides,
    comparator: arrayEqual,
    summary,
    formatter: (value) => (Array.isArray(value) ? value : []),
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'ownerName',
    targetValue: sheetRecord.ownerName,
    baseValue: listing.base.ownerName,
    overrides,
    comparator: (a, b) => a === b,
    summary,
    formatter: stringFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'mailingAddressLine1',
    targetValue: effectiveMailingAddressLine1,
    baseValue: listing.base.mailingAddressLine1,
    overrides,
    comparator: (a, b) => a === b,
    summary,
    formatter: multilineFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'mailingAddressLine2',
    targetValue: effectiveMailingAddressLine2,
    baseValue: listing.base.mailingAddressLine2,
    overrides,
    comparator: (a, b) => a === b,
    summary,
    formatter: multilineFormatter,
  });

  applyOverrideField({
    key: 'mailingCity',
    targetValue: effectiveMailingCity,
    baseValue: listing.base.mailingCity,
    overrides,
    comparator: (a, b) => a.toLowerCase() === b.toLowerCase(),
    summary,
    formatter: stringFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'mailingState',
    targetValue: effectiveMailingState,
    baseValue: listing.base.mailingState,
    overrides,
    comparator: (a, b) => a.toUpperCase() === b.toUpperCase(),
    summary,
    formatter: (value) => stringFormatter(value).toUpperCase(),
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'mailingZip5',
    targetValue: effectiveMailingZip5,
    baseValue: listing.base.mailingZip5,
    overrides,
    comparator: (a, b) => zipFormatter(a) === zipFormatter(b),
    summary,
    formatter: stringFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'mailingZip9',
    targetValue: effectiveMailingZip9,
    baseValue: listing.base.mailingZip9,
    overrides,
    comparator: (a, b) => zipFormatter(a) === zipFormatter(b),
    summary,
    formatter: stringFormatter,
    preserveExistingOnEmpty: true,
  });

  applyOverrideField({
    key: 'mailingAddress',
    targetValue: effectiveMailingAddress,
    baseValue: listing.base.mailingAddress,
    overrides,
    comparator: (a, b) => a === b,
    summary,
    formatter: multilineFormatter,
    preserveExistingOnEmpty: true,
  });

  const sanitized = sanitiseOverridesForStorage(overrides);
  const normalizedNew = normaliseCustomizationOverrides(sanitized);
  const normalizedExisting = normaliseCustomizationOverrides(listing.overrides);

  const hasOverrides = Object.keys(normalizedNew).length > 0;
  const overridesEqual = shallowEqual(normalizedExisting, normalizedNew);

  let operation = 'none';
  if (!hasOverrides) {
    operation = Object.keys(normalizedExisting).length > 0 ? 'delete' : 'none';
  } else if (!overridesEqual) {
    operation = 'upsert';
  }

  return {
    listing,
    sheetRecord,
    summary,
    sanitizedOverrides: sanitized,
    normalizedOverrides: normalizedNew,
    operation,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
  }

  const csvContent = await fs.readFile(options.input, 'utf8');
  const rawRows = parseCsv(csvContent);
  const sheetRecords = parseSpreadsheetRecords(rawRows);

  if (sheetRecords.length === 0) {
    console.error('No data rows were parsed from the spreadsheet.');
    process.exit(1);
  }

  console.log(`Parsed ${sheetRecords.length} row(s) from the spreadsheet.`);

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Supabase environment variables are missing. Set SUPABASE_URL and SUPABASE_ANON_KEY (or service key).',
    );
    process.exit(1);
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log('Fetching current listings and overrides from Supabase...');
  const [listingRows, overridesById] = await Promise.all([
    fetchAllListings(client),
    fetchListingCustomizations(client),
  ]);

  const listingRecords = buildListingRecords(listingRows, overridesById);
  const listingIndex = buildListingIndex(listingRecords);

  const unmatched = [];
  const ambiguous = [];
  const results = [];
  const matchedListingIdsSet = new Set();
  const complexAliasMap = new Map();

  sheetRecords.forEach((record) => {
    const resolution = resolveListing(record, listingRecords, listingIndex, complexAliasMap);
    if (resolution.status === 'missing') {
      unmatched.push(record);
      return;
    }
    if (resolution.status === 'ambiguous') {
      ambiguous.push({ record, candidates: resolution.candidates });
      return;
    }

    const outcome = computeOverrideUpdate(resolution.listing, record);
    results.push(outcome);
    matchedListingIdsSet.add(outcome.listing.id);
  });

  console.log('');
  console.log(`Matched ${results.length} listing(s).`);
  const matchedListingIds = Array.from(matchedListingIdsSet);
  if (unmatched.length > 0) {
    console.warn(`Unmatched rows (${unmatched.length}):`);
    unmatched.forEach((entry) => {
      console.warn(
        `  • Complex "${entry.complex}" unit "${entry.unit}" (row ${entry.sourceRow})`,
      );
    });
  }
  if (ambiguous.length > 0) {
    console.warn(`Ambiguous matches (${ambiguous.length}):`);
    ambiguous.forEach((entry) => {
      const candidateText = entry.candidates
        .map((candidate) => `${candidate.complex || candidate.subdivision} • ${candidate.unit}`)
        .join('; ');
      console.warn(
        `  • Complex "${entry.record.complex}" unit "${entry.record.unit}" candidates: ${candidateText}`,
      );
    });
  }

  const upserts = [];
  const deletions = [];
  const skipped = [];

  results.forEach((outcome) => {
    const {
      listing: listingInfo,
      sheetRecord,
      summary,
      sanitizedOverrides,
      operation,
    } = outcome;
    const label = `${listingInfo.complex || listingInfo.subdivision || 'Unknown complex'} • ${listingInfo.unit} (${listingInfo.id})`;

    if (operation === 'none') {
      skipped.push({ label, sheetRecord });
      return;
    }

    if (operation === 'delete') {
      deletions.push({ id: listingInfo.id, label });
      console.log(`[DELETE] ${label}`);
      summary.forEach((change) => {
        console.log(
          `    - ${change.field}: ${change.action} (previous: ${JSON.stringify(change.from)})`,
        );
      });
      return;
    }

    upserts.push({ listing_id: listingInfo.id, overrides: sanitizedOverrides, label, summary });
    console.log(`[UPSERT] ${label}`);
    summary.forEach((change) => {
      console.log(
        `    - ${change.field}: ${change.action} (${JSON.stringify(change.from)} → ${JSON.stringify(change.to)})`,
      );
    });
  });

  console.log('');
  console.log(
    `Planned actions: ${upserts.length} upsert(s), ${deletions.length} deletion(s), ${skipped.length} unchanged listing(s).`,
  );

  if (!options.allowPartial && (unmatched.length > 0 || ambiguous.length > 0)) {
    console.warn(
      'Aborting because some rows were unmatched or ambiguous. Re-run with --allow-partial to apply partial updates.',
    );
    process.exit(1);
  }

  if (!options.apply) {
    if (options.watchlistName) {
      console.warn(
        'Skipping watchlist creation during dry run. Re-run with --apply to create the watchlist.',
      );
    }
    console.log('Dry run complete. Re-run with --apply to persist these overrides.');
    process.exit(0);
  }

  if (upserts.length > 0) {
    const chunkSize = 50;
    for (let index = 0; index < upserts.length; index += chunkSize) {
      const chunk = upserts.slice(index, index + chunkSize);
      const payload = chunk.map((entry) => ({
        listing_id: entry.listing_id,
        overrides: entry.overrides,
      }));
      const { error } = await client
        .from('listing_customizations')
        .upsert(payload, { onConflict: 'listing_id' });
      if (error) {
        throw new Error(`Failed to upsert overrides: ${error.message}`);
      }
    }
  }

  if (deletions.length > 0) {
    const chunkSize = 50;
    for (let index = 0; index < deletions.length; index += chunkSize) {
      const chunk = deletions.slice(index, index + chunkSize);
      const ids = chunk.map((entry) => entry.id);
      const { error } = await client.from('listing_customizations').delete().in('listing_id', ids);
      if (error) {
        throw new Error(`Failed to delete overrides: ${error.message}`);
      }
    }
  }

  let createdWatchlistId = null;
  if (options.watchlistName) {
    const trimmedName = options.watchlistName.trim();
    if (matchedListingIds.length === 0) {
      console.warn(
        `Watchlist "${trimmedName}" was requested but no listings were matched. Skipping creation.`,
      );
    } else {
      const { data: watchlistRow, error: watchlistError } = await client
        .from('watchlists')
        .insert({ name: trimmedName })
        .select('id')
        .single();

      if (watchlistError) {
        throw new Error(
          `Failed to create watchlist "${trimmedName}": ${watchlistError.message}`,
        );
      }

      const watchlistId =
        typeof watchlistRow?.id === 'string' ? watchlistRow.id : null;
      if (!watchlistId) {
        throw new Error(`Watchlist "${trimmedName}" was created but an ID was not returned.`);
      }

      const rows = matchedListingIds.map((listingId) => ({
        watchlist_id: watchlistId,
        listing_id: listingId,
      }));

      const watchlistChunkSize = 200;
      for (let index = 0; index < rows.length; index += watchlistChunkSize) {
        const chunk = rows.slice(index, index + watchlistChunkSize);
        if (chunk.length === 0) {
          continue;
        }
        const { error: watchlistInsertError } = await client
          .from('watchlist_listings')
          .insert(chunk);
        if (watchlistInsertError) {
          throw new Error(
            `Failed to populate watchlist "${trimmedName}": ${watchlistInsertError.message}`,
          );
        }
      }

      createdWatchlistId = watchlistId;
      console.log(
        `Created watchlist "${trimmedName}" with ${rows.length.toLocaleString()} listing(s).`,
      );
    }
  }

  if (createdWatchlistId) {
    console.log(`Watchlist ID: ${createdWatchlistId}`);
  }

  console.log('Overrides applied successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
