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

    entries.push({
      id,
      waitlistType,
      waitlistLabel: label,
      position: Number.isNaN(positionValue) ? null : positionValue,
      addressLine1,
      addressLine2: addressLine2 || '',
      normalizedLine1: normaliseAddressPart(addressLine1),
      normalizedLine2: normaliseAddressPart(addressLine2),
      normalizedAddress: buildNormalisedAddress(addressLine1, addressLine2),
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
  const exact = new Map();
  const line1Only = new Map();

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
    const line1 = sanitiseLine(listing.mailing_address_line1);
    const line2 = sanitiseLine(listing.mailing_address_line2);
    const normalizedLine1 = normaliseAddressPart(line1);
    const normalizedLine2 = normaliseAddressPart(line2);
    if (!normalizedLine1) {
      return;
    }
    const normalizedAddress =
      normalizedLine2.length > 0 ? `${normalizedLine1}|${normalizedLine2}` : normalizedLine1;
    pushToMap(exact, normalizedAddress, listing);
    pushToMap(line1Only, normalizedLine1, listing);
  });

  return { exact, line1Only };
}

function matchEntries(entries, listingIndexes) {
  const matches = [];
  let unmatchedCount = 0;

  entries.forEach((entry) => {
    let resolvedMatch = null;

    const exactCandidates = listingIndexes.exact.get(entry.normalizedAddress);
    if (exactCandidates && exactCandidates.length === 1) {
      resolvedMatch = {
        entryId: entry.id,
        listingId: exactCandidates[0].id,
        matchType: 'address_line1_line2',
        matchScore: 1,
      };
    }

    if (!resolvedMatch) {
      const line1Candidates = listingIndexes.line1Only.get(entry.normalizedLine1);
      if (line1Candidates && line1Candidates.length === 1) {
        resolvedMatch = {
          entryId: entry.id,
          listingId: line1Candidates[0].id,
          matchType: 'address_line1',
          matchScore: 0.75,
        };
      }
    }

    if (resolvedMatch) {
      matches.push(resolvedMatch);
    } else {
      unmatchedCount += 1;
    }
  });

  return { matches, unmatchedCount };
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
  const { matches, unmatchedCount } = matchEntries(allEntries, indexes);
  console.log(
    `[match] ${matches.length.toLocaleString()} entries matched (${unmatchedCount.toLocaleString()} unmatched).`,
  );

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
