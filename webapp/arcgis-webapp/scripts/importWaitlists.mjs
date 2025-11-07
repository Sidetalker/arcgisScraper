#!/usr/bin/env node

/**
 * Imports waitlist spreadsheets for the Upper and Lower Blue Basin queues,
 * normalises the addresses, attempts to match each row to a known listing
 * owner, and persists the results to Supabase.
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;
const WAITLIST_VARIANTS = {
  upper: {
    waitlistType: 'upper_blue_basin',
    label: 'Upper Blue Basin',
  },
  lower: {
    waitlistType: 'lower_blue_basin',
    label: 'Lower Blue Basin',
  },
};

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
    let value = sanitizedLine.slice(separatorIndex + 1).trim();

    if (!key || key in process.env) {
      continue;
    }

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

function printUsage() {
  console.log(`Usage: node scripts/importWaitlists.mjs [--upper UpperBlue.csv] [--lower LowerBlue.csv] [--apply]

Options:
  --upper <path>   Path to the Upper Blue Basin waitlist CSV/TSV
  --lower <path>   Path to the Lower Blue Basin waitlist CSV/TSV
  --apply          Persist rows and matches to Supabase (omit for dry run)
  --help, -h       Show this message
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    inputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case '--upper': {
        if (options.inputs.find((entry) => entry.waitlistType === WAITLIST_VARIANTS.upper.waitlistType)) {
          throw new Error('Specify --upper only once.');
        }
        const filePath = argv[index + 1];
        if (!filePath || filePath.startsWith('-')) {
          throw new Error('Missing value for --upper <path>');
        }
        options.inputs.push({
          ...WAITLIST_VARIANTS.upper,
          filePath,
        });
        index += 1;
        break;
      }
      case '--lower': {
        if (options.inputs.find((entry) => entry.waitlistType === WAITLIST_VARIANTS.lower.waitlistType)) {
          throw new Error('Specify --lower only once.');
        }
        const filePath = argv[index + 1];
        if (!filePath || filePath.startsWith('-')) {
          throw new Error('Missing value for --lower <path>');
        }
        options.inputs.push({
          ...WAITLIST_VARIANTS.lower,
          filePath,
        });
        index += 1;
        break;
      }
      case '--apply': {
        options.apply = true;
        break;
      }
      case '--help':
      case '-h': {
        printUsage();
        process.exit(0);
      }
      default: {
        if (token.startsWith('-')) {
          throw new Error(`Unknown option: ${token}`);
        }
      }
    }
  }

  if (options.inputs.length === 0) {
    throw new Error('Provide at least one waitlist file via --upper and/or --lower.');
  }

  return options;
}

function detectDelimiter(content) {
  const [firstLine = ''] = content.split(/\r?\n/, 1);
  if (firstLine.includes(',')) {
    return ',';
  }
  if (firstLine.includes('\t')) {
    return '\t';
  }
  if (firstLine.includes(';')) {
    return ';';
  }
  return ',';
}

function parseDelimited(content, delimiter) {
  const rows = [];
  const currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  const flushValue = () => {
    currentRow.push(currentValue);
    currentValue = '';
  };

  const flushRow = () => {
    if (currentRow.length === 0 && currentValue.length === 0) {
      return;
    }
    flushValue();
    rows.push([...currentRow]);
    currentRow.length = 0;
  };

  for (let index = 0; index < content.length; index += 1) {
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

    if (char === delimiter) {
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

  if (currentValue.length > 0 || currentRow.length > 0) {
    flushRow();
  }

  return rows;
}

function normaliseHeader(key) {
  return key.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[_-]+/g, ' ');
}

function resolveColumnIndexes(headerRow) {
  const columns = new Map();
  headerRow.forEach((value, index) => {
    const key = normaliseHeader(value);
    if (key.length === 0) {
      return;
    }
    columns.set(key, index);
  });

  const numberIndex =
    columns.get('number') ??
    columns.get('#') ??
    columns.get('position') ??
    columns.get('rank') ??
    null;
  const addressLine1Index =
    columns.get('address line 1') ??
    columns.get('address 1') ??
    columns.get('address') ??
    columns.get('address line1') ??
    columns.get('addr line 1') ??
    null;
  const addressLine2Index =
    columns.get('address line 2') ??
    columns.get('address 2') ??
    columns.get('address line2') ??
    columns.get('addr line 2') ??
    null;

  if (addressLine1Index === null) {
    throw new Error('Missing "Address Line 1" column.');
  }

  return {
    numberIndex,
    addressLine1Index,
    addressLine2Index,
  };
}

function sanitiseLine(value) {
  if (!value) {
    return '';
  }
  return value.trim();
}

function normaliseAddressPart(value) {
  if (!value) {
    return '';
  }
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildNormalisedAddress(line1, line2) {
  const primary = normaliseAddressPart(line1);
  const secondary = normaliseAddressPart(line2);
  if (secondary) {
    return `${primary}|${secondary}`;
  }
  return primary;
}

function normaliseUnit(value) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  }
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function collectUnitTokensFromText(input, tokens) {
  if (typeof input !== 'string') {
    return;
  }
  const text = input.trim();
  if (!text) {
    return;
  }

  const unitPattern =
    /\b(?:unit|apt|apartment|suite|ste|lot|trlr|room|bldg|building)\s*([A-Za-z0-9-]+)/gi;
  let match = unitPattern.exec(text);
  while (match) {
    const value = normaliseUnit(match[1] ?? '');
    if (value) {
      tokens.add(value);
    }
    match = unitPattern.exec(text);
  }

  const hashPattern = /#\s*([A-Za-z0-9-]+)/gi;
  match = hashPattern.exec(text);
  while (match) {
    const value = normaliseUnit(match[1] ?? '');
    if (value) {
      tokens.add(value);
    }
    match = hashPattern.exec(text);
  }

  if (text.length <= 8 && /^[A-Za-z0-9-]+$/.test(text) && !/po\s*box/i.test(text)) {
    const standalone = normaliseUnit(text);
    if (standalone) {
      tokens.add(standalone);
    }
  }
}

function extractUnitHints(...lines) {
  const tokens = new Set();
  lines.forEach((line) => collectUnitTokensFromText(line, tokens));
  return Array.from(tokens);
}

function stripUnitDesignators(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(
      /\b(?:unit|apt|apartment|suite|ste|lot|trlr|room|bldg|building)\s*[A-Za-z0-9-]+/gi,
      '',
    )
    .replace(/#\s*[A-Za-z0-9-]+/gi, '')
    .trim();
}

function extractPrimaryAddressLine(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return '';
  }
  const [firstLine] = normalized.split('\n');
  if (!firstLine) {
    return '';
  }
  const [beforeComma] = firstLine.split(',');
  return beforeComma.trim();
}

function buildStreetUnitKey(streetKey, unitKey) {
  if (!streetKey || !unitKey) {
    return '';
  }
  return `${streetKey}|${unitKey}`;
}

function parseEntriesFromRows({
  rows,
  waitlistType,
  label,
  sourceFilename,
}) {
  if (rows.length === 0) {
    return [];
  }

  const header = rows[0];
  const { numberIndex, addressLine1Index, addressLine2Index } = resolveColumnIndexes(header);
  const entries = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const addressLine1 = sanitiseLine(row[addressLine1Index]);
    if (!addressLine1) {
      continue;
    }
    const addressLine2 = addressLine2Index === null ? '' : sanitiseLine(row[addressLine2Index]);
    const positionValueRaw = numberIndex === null ? '' : sanitiseLine(row[numberIndex]);
    const positionValue = Number.parseInt(positionValueRaw, 10);
    const id = randomUUID();
    const normalizedLine1 = normaliseAddressPart(addressLine1);
    const normalizedLine2 = normaliseAddressPart(addressLine2);
    const normalizedAddress = buildNormalisedAddress(addressLine1, addressLine2);
    const normalizedLine1StrippedRaw = normaliseAddressPart(stripUnitDesignators(addressLine1));
    const normalizedLine1Stripped = normalizedLine1StrippedRaw || normalizedLine1;
    const unitKeys = extractUnitHints(addressLine1, addressLine2);
    const streetUnitKeys = unitKeys
      .map((unitKey) => buildStreetUnitKey(normalizedLine1Stripped, unitKey))
      .filter((key) => key.length > 0);

    entries.push({
      id,
      waitlistType,
      waitlistLabel: label,
      position: Number.isNaN(positionValue) ? null : positionValue,
      addressLine1,
      addressLine2: addressLine2 || '',
      normalizedLine1,
      normalizedLine2,
      normalizedLine1Stripped,
      normalizedAddress,
      unitKeys,
      streetUnitKeys,
      sourceFilename,
      sourceRowNumber: rowIndex + 1,
      raw: {
        number: positionValueRaw || null,
        addressLine1,
        addressLine2: addressLine2 || null,
      },
    });
  }

  return entries;
}

async function readWaitlistFile(input) {
  const resolvedPath = path.resolve(input.filePath);
  const fileContents = await fsPromises.readFile(resolvedPath, 'utf8');
  const delimiter = detectDelimiter(fileContents);
  const rows = parseDelimited(fileContents, delimiter);
  return parseEntriesFromRows({
    rows,
    waitlistType: input.waitlistType,
    label: input.label,
    sourceFilename: path.basename(resolvedPath),
  });
}

async function fetchAllListings(client) {
  const columns = [
    'id',
    'owner_name',
    'owner_names',
    'mailing_address',
    'mailing_address_line1',
    'mailing_address_line2',
    'mailing_city',
    'mailing_state',
    'mailing_zip5',
    'mailing_zip9',
    'unit',
    'unit_normalized',
    'physical_address',
  ].join(',');

  const listings = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + DEFAULT_PAGE_SIZE - 1;
    const { data, error } = await client
      .from('listings')
      .select(columns)
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    const batch = Array.isArray(data) ? data : [];
    listings.push(...batch);

    if (batch.length < DEFAULT_PAGE_SIZE) {
      hasMore = false;
    } else {
      from += DEFAULT_PAGE_SIZE;
    }
  }

  return listings;
}

function buildListingIndexes(listings) {
  const indexes = {
    mailingExact: new Map(),
    mailingLine1: new Map(),
    physicalPrimary: new Map(),
    physicalStreet: new Map(),
    streetUnit: new Map(),
  };

  const pushToMap = (map, key, listing) => {
    if (!key) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(listing);
  };

  listings.forEach((listing) => {
    const enriched = enrichListingForMatching(listing);
    if (!enriched) {
      return;
    }
    pushToMap(indexes.mailingExact, enriched.normalizedMailingAddress, enriched);
    pushToMap(indexes.mailingLine1, enriched.normalizedMailingLine1, enriched);
    pushToMap(indexes.physicalPrimary, enriched.physicalPrimary, enriched);
    pushToMap(indexes.physicalStreet, enriched.physicalStreetKey, enriched);
    pushToMap(indexes.streetUnit, enriched.streetUnitKey, enriched);
  });

  return indexes;
}

function enrichListingForMatching(listing) {
  const mailingLine1 = sanitiseLine(listing.mailing_address_line1);
  const mailingLine2 = sanitiseLine(listing.mailing_address_line2);
  const normalizedMailingLine1 = normaliseAddressPart(mailingLine1);
  const normalizedMailingAddress =
    normalizedMailingLine1.length > 0 ? buildNormalisedAddress(mailingLine1, mailingLine2) : '';

  const physicalPrimaryLine = extractPrimaryAddressLine(listing.physical_address ?? '');
  const physicalPrimary = normaliseAddressPart(physicalPrimaryLine);
  const physicalStreetRaw = stripUnitDesignators(physicalPrimaryLine);
  const physicalStreetKey = normaliseAddressPart(physicalStreetRaw) || physicalPrimary;

  const unitNormalized = normaliseUnit(listing.unit_normalized ?? listing.unit ?? '');
  const streetUnitKey = buildStreetUnitKey(physicalStreetKey, unitNormalized);

  if (
    !normalizedMailingAddress &&
    !normalizedMailingLine1 &&
    !physicalPrimary &&
    !physicalStreetKey
  ) {
    return null;
  }

  const ownerName = typeof listing.owner_name === 'string' ? listing.owner_name.trim() : '';

  return {
    id: listing.id,
    unitNormalized,
    normalizedMailingAddress,
    normalizedMailingLine1,
    physicalPrimary,
    physicalStreetKey,
    streetUnitKey,
    ownerName,
  };
}

function matchEntries(entries, listingIndexes) {
  const matches = [];
  const stats = {
    total: entries.length,
    exact: 0,
    close: 0,
    missed: 0,
    lowConfidenceCount: 0,
    lowConfidenceSamples: [],
  };

  entries.forEach((entry) => {
    const { match, lowConfidence } = resolveMatchForEntry(entry, listingIndexes);
    if (match) {
      matches.push(match);
      if (match.matchScore >= 0.99) {
        stats.exact += 1;
      } else {
        stats.close += 1;
      }
      return;
    }

    stats.missed += 1;
    if (lowConfidence) {
      stats.lowConfidenceCount += 1;
      if (stats.lowConfidenceSamples.length < 10) {
        stats.lowConfidenceSamples.push(lowConfidence);
      }
    }
  });

  return { matches, stats };
}

function resolveMatchForEntry(entry, listingIndexes) {
  let lowConfidenceCandidate = null;

  const attempts = [
    {
      map: listingIndexes.mailingExact,
      key: entry.normalizedAddress,
      type: 'mailing_address',
      score: 1,
    },
    {
      map: listingIndexes.mailingLine1,
      key: entry.normalizedLine1,
      type: 'mailing_line1',
      score: 0.95,
    },
  ];

  for (const key of entry.streetUnitKeys ?? []) {
    attempts.push({
      map: listingIndexes.streetUnit,
      key,
      type: 'physical_street_unit',
      score: 0.93,
    });
  }

  attempts.push(
    {
      map: listingIndexes.physicalPrimary,
      key: entry.normalizedLine1,
      type: 'physical_primary',
      score: 0.9,
    },
    {
      map: listingIndexes.physicalStreet,
      key: entry.normalizedLine1Stripped,
      type: 'physical_street',
      score: 0.88,
    },
  );

  for (const attempt of attempts) {
    if (!attempt.key) {
      continue;
    }
    const candidates = attempt.map.get(attempt.key);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      continue;
    }
    const listing = pickCandidateForEntry(entry, candidates);
    if (listing) {
      return {
        match: {
          entryId: entry.id,
          listingId: listing.id,
          matchType: attempt.type,
          matchScore: attempt.score,
        },
        lowConfidence: lowConfidenceCandidate,
      };
    }

    if (!lowConfidenceCandidate) {
      lowConfidenceCandidate = createLowConfidenceSample(entry, attempt, candidates);
    }
  }

  return { match: null, lowConfidence: lowConfidenceCandidate };
}

function createLowConfidenceSample(entry, attempt, candidates) {
  return {
    entryId: entry.id,
    waitlistType: entry.waitlistType,
    waitlistLabel: entry.waitlistLabel,
    addressLine1: entry.addressLine1,
    attemptType: attempt.type,
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    candidateListingIds: Array.isArray(candidates)
      ? candidates.slice(0, 5).map((candidate) => candidate.id)
      : [],
  };
}

function pickCandidateForEntry(entry, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const entryUnitSet = new Set(entry.unitKeys ?? []);
  if (entryUnitSet.size > 0) {
    const unitMatches = candidates.filter(
      (listing) => listing.unitNormalized && entryUnitSet.has(listing.unitNormalized),
    );
    if (unitMatches.length === 1) {
      return unitMatches[0];
    }
    if (unitMatches.length > 0) {
      candidates = unitMatches;
    }
  }

  if (entryUnitSet.size === 0) {
    const noUnitCandidates = candidates.filter((listing) => !listing.unitNormalized);
    if (noUnitCandidates.length === 1) {
      return noUnitCandidates[0];
    }
    if (noUnitCandidates.length > 0) {
      candidates = noUnitCandidates;
    }
  }

  const ownerNames = new Set(
    candidates
      .map((listing) => (typeof listing.ownerName === 'string' ? listing.ownerName : ''))
      .filter((name) => name.length > 0),
  );
  if (ownerNames.size === 1 && candidates.length > 0) {
    return candidates[0];
  }

  return null;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function upsertEntries(client, entries) {
  const payload = entries.map((entry) => ({
    id: entry.id,
    waitlist_type: entry.waitlistType,
    position: entry.position,
    address_line1: entry.addressLine1,
    address_line2: entry.addressLine2 || null,
    normalized_address: entry.normalizedAddress,
    normalized_line1: entry.normalizedLine1,
    normalized_line2: entry.normalizedLine2 || null,
    source_filename: entry.sourceFilename,
    source_row_number: entry.sourceRowNumber,
    raw: entry.raw,
  }));

  for (const chunk of chunkArray(payload, INSERT_CHUNK_SIZE)) {
    const { error } = await client.from('waitlist_entries').insert(chunk);
    if (error) {
      throw new Error(`Failed to insert waitlist chunk: ${error.message}`);
    }
  }
}

async function insertMatches(client, matches) {
  if (matches.length === 0) {
    return;
  }

  for (const chunk of chunkArray(matches, INSERT_CHUNK_SIZE)) {
    const { error } = await client.from('waitlist_entry_matches').insert(
      chunk.map((match) => ({
        entry_id: match.entryId,
        listing_id: match.listingId,
        match_type: match.matchType,
        match_score: match.matchScore,
      })),
    );
    if (error) {
      throw new Error(`Failed to insert match chunk: ${error.message}`);
    }
  }
}

async function deleteExistingEntries(client, waitlistTypes) {
  for (const waitlistType of waitlistTypes) {
    const { error } = await client
      .from('waitlist_entries')
      .delete()
      .eq('waitlist_type', waitlistType);
    if (error) {
      throw new Error(`Failed to delete existing rows for ${waitlistType}: ${error.message}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

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
    throw new Error('Missing Supabase URL. Set SUPABASE_URL (or VITE_/NEXT_PUBLIC_ variants).');
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase service role key. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).');
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const entriesByWaitlist = await Promise.all(
    options.inputs.map(async (input) => {
      const rows = await readWaitlistFile(input);
      console.log(
        `[parse] ${input.label}: ${rows.length.toLocaleString()} row(s) parsed from ${path.resolve(input.filePath)}`,
      );
      return rows;
    }),
  );

  const allEntries = entriesByWaitlist.flat();
  const waitlistTypes = Array.from(new Set(allEntries.map((entry) => entry.waitlistType)));

  console.log(`[parse] Total entries ready: ${allEntries.length.toLocaleString()}`);

  console.log('[match] Fetching listings from Supabase...');
  const listings = await fetchAllListings(client);
  console.log(`[match] Loaded ${listings.length.toLocaleString()} listing(s) for matching.`);

  const indexes = buildListingIndexes(listings);
  const { matches, stats } = matchEntries(allEntries, indexes);
  console.log(
    `[match] ${matches.length.toLocaleString()} entries matched (${stats.missed.toLocaleString()} unmatched).`,
  );
  console.log(
    `[match] Exact: ${stats.exact.toLocaleString()} • Close: ${stats.close.toLocaleString()} • Low-confidence candidates: ${stats.lowConfidenceCount.toLocaleString()}`,
  );
  if (stats.lowConfidenceSamples.length > 0) {
    console.log('[match] Sample low-confidence entries requiring manual review:');
    stats.lowConfidenceSamples.forEach((sample) => {
      const label = sample.waitlistLabel || sample.waitlistType || 'waitlist';
      const candidateList =
        sample.candidateListingIds.length > 0 ? sample.candidateListingIds.join(', ') : 'n/a';
      console.log(
        `  - ${label} → ${sample.addressLine1} (${sample.attemptType}) had ${sample.candidateCount} candidate(s) [${candidateList}]`,
      );
    });
  }

  if (!options.apply) {
    console.log('Dry run complete. Re-run with --apply to persist rows and matches.');
    return;
  }

  console.log('[persist] Removing existing waitlist entries for imported queues...');
  await deleteExistingEntries(client, waitlistTypes);

  console.log('[persist] Inserting waitlist rows...');
  await upsertEntries(client, allEntries);

  console.log('[persist] Inserting matches...');
  await insertMatches(client, matches);

  console.log(
    `[done] Imported ${allEntries.length.toLocaleString()} rows with ${matches.length.toLocaleString()} matches.`,
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
