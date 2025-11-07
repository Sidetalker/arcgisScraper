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

const STREET_ALIAS_MAP = new Map([
  ['road', 'rd'],
  ['rd', 'rd'],
  ['drive', 'dr'],
  ['dr', 'dr'],
  ['street', 'st'],
  ['st', 'st'],
  ['avenue', 'ave'],
  ['ave', 'ave'],
  ['boulevard', 'blvd'],
  ['blvd', 'blvd'],
  ['lane', 'ln'],
  ['ln', 'ln'],
  ['court', 'ct'],
  ['ct', 'ct'],
  ['circle', 'cir'],
  ['cir', 'cir'],
  ['parkway', 'pkwy'],
  ['pkwy', 'pkwy'],
  ['trail', 'trl'],
  ['trl', 'trl'],
  ['terrace', 'ter'],
  ['ter', 'ter'],
  ['place', 'pl'],
  ['pl', 'pl'],
  ['highway', 'hwy'],
  ['hwy', 'hwy'],
  ['mountain', 'mtn'],
  ['mtn', 'mtn'],
  ['mount', 'mt'],
  ['mt', 'mt'],
  ['driveway', 'drwy'],
  ['north', 'n'],
  ['south', 's'],
  ['east', 'e'],
  ['west', 'w'],
  ['northeast', 'ne'],
  ['northwest', 'nw'],
  ['southeast', 'se'],
  ['southwest', 'sw'],
]);

const STREET_IGNORE_TOKENS = new Set([
  'unit',
  'apt',
  'apartment',
  'suite',
  'ste',
  'lot',
  'trlr',
  'room',
  'bldg',
  'building',
  'po',
  'box',
  'county',
]);

const STREET_SUFFIX_TOKENS = new Set([
  'rd',
  'dr',
  'st',
  'ave',
  'blvd',
  'ln',
  'ct',
  'cir',
  'pkwy',
  'trl',
  'ter',
  'pl',
  'hwy',
  'mtn',
  'mt',
  'drwy',
  'way',
  'loop',
  'parkway',
]);

const STREET_DIRECTION_TOKENS = new Set([
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
]);

function expandStreetAbbreviations(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value ?? '';
  }
  return value.replace(/\bcr\b/gi, 'county road').replace(/\bco\s+rd\b/gi, 'county road');
}
const TYPO_CORRECTIONS = new Map([
  ['mooinstone', 'moonstone'],
]);

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

  let resolvedAddressLine2Index = addressLine2Index;
  if (resolvedAddressLine2Index === null) {
    const unitLikeIndex =
      columns.get('unit') ??
      columns.get('unit number') ??
      columns.get('unit #') ??
      columns.get('unit no') ??
      columns.get('building') ??
      columns.get('bldg') ??
      null;
    if (unitLikeIndex !== null && unitLikeIndex !== undefined) {
      resolvedAddressLine2Index = unitLikeIndex;
    }
  }
  if (resolvedAddressLine2Index === null) {
    const unlabeledIndex = headerRow.findIndex((value, index) => {
      if (index === numberIndex || index === addressLine1Index) {
        return false;
      }
      if (typeof value !== 'string') {
        return true;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return true;
      }
      return /^unnamed[:\s]*\d*$/i.test(trimmed);
    });
    if (unlabeledIndex !== -1) {
      resolvedAddressLine2Index = unlabeledIndex;
    }
  }

  if (resolvedAddressLine2Index === null && headerRow.length >= 4 && addressLine1Index !== 3 && numberIndex !== 3) {
    const rawValue = headerRow[3];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (rawValue === undefined || value.length === 0 || /^unnamed[:\s]*\d*$/i.test(value)) {
      resolvedAddressLine2Index = 3;
    }
  }

  if (addressLine1Index === null) {
    throw new Error('Missing "Address Line 1" column.');
  }

  return {
    numberIndex,
    addressLine1Index,
    addressLine2Index: resolvedAddressLine2Index,
  };
}

function normaliseQuotes(value) {
  if (typeof value !== 'string') {
    return value ?? '';
  }
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"');
}

function sanitiseLine(value) {
  if (!value) {
    return '';
  }
  let sanitised = normaliseQuotes(String(value).trim());
  if (
    (sanitised.startsWith('"') && sanitised.endsWith('"')) ||
    (sanitised.startsWith("'") && sanitised.endsWith("'"))
  ) {
    sanitised = sanitised.slice(1, -1).trim();
  }
  return sanitised;
}

function findOverflowAddressLine(row, skipIndexes) {
  for (let index = 0; index < row.length; index += 1) {
    if (skipIndexes.has(index)) {
      continue;
    }
    const rawValue = row[index];
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const value = sanitiseLine(rawValue);
    if (!value) {
      continue;
    }
    if (/(unit|bldg|building|apt|suite|#)/i.test(value)) {
      return value;
    }
  }
  return '';
}

function normaliseAddressPart(value) {
  if (!value) {
    return '';
  }
  const expanded = expandStreetAbbreviations(value);
  const withoutParens = stripParentheticalSegments(expanded);
  return withoutParens
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (STREET_IGNORE_TOKENS.has(token)) {
        return '';
      }
      let normalized = STREET_ALIAS_MAP.get(token) ?? token;
      if (/^[0-9]+$/.test(normalized)) {
        const numericValue = Number.parseInt(normalized, 10);
        if (!Number.isNaN(numericValue)) {
          normalized = String(numericValue);
        }
      }
      return normalized;
    })
    .filter(Boolean)
    .join('');
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
    value = String(value);
  }
  const sanitized = value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (/^[0-9]+$/.test(sanitized)) {
    const numericValue = Number.parseInt(sanitized, 10);
    if (!Number.isNaN(numericValue)) {
      return String(numericValue);
    }
  }
  return sanitized;
}

function collectUnitTokensFromText(input, tokens) {
  if (typeof input !== 'string') {
    return;
  }
  const text = input.trim();
  if (!text) {
    return;
  }

  const normalizedText = text.replace(/\bunti\b/gi, 'unit');

  const unitPattern =
    /\b(?:unit|apt|apartment|suite|ste|lot|trlr|room|bldg|building)\s*([A-Za-z0-9-]+)/gi;
  let match = unitPattern.exec(normalizedText);
  while (match) {
    const value = normaliseUnit(match[1] ?? '');
    if (value) {
      tokens.add(value);
    }
    match = unitPattern.exec(normalizedText);
  }

  const hashPattern = /#\s*([A-Za-z0-9-]+)/gi;
  match = hashPattern.exec(normalizedText);
  while (match) {
    const value = normaliseUnit(match[1] ?? '');
    if (value) {
      tokens.add(value);
    }
    match = hashPattern.exec(normalizedText);
  }

  const letterNumberPattern = /\b([A-Za-z]{1,4})\s*([0-9]{1,4})\b/g;
  match = letterNumberPattern.exec(normalizedText);
  while (match) {
    const letters = normaliseUnit(match[1] ?? '');
    const digits = normaliseUnit(match[2] ?? '');
    if (letters && digits) {
      tokens.add(`${letters}${digits}`);
      tokens.add(digits);
    } else if (digits) {
      tokens.add(digits);
    }
    match = letterNumberPattern.exec(normalizedText);
  }

  const digitsOnlyPattern = /\b([0-9]{1,4})\b/g;
  match = digitsOnlyPattern.exec(normalizedText);
  while (match) {
    const digits = normaliseUnit(match[1] ?? '');
    if (digits) {
      tokens.add(digits);
    }
    match = digitsOnlyPattern.exec(normalizedText);
  }

  if (
    normalizedText.length <= 8 &&
    /^[A-Za-z0-9-]+$/.test(normalizedText) &&
    !/po\s*box/i.test(normalizedText)
  ) {
    const standalone = normaliseUnit(normalizedText);
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

function ensureEntryUnitHints(entry) {
  const hints = new Set(entry.unitKeys ?? []);
  if (typeof entry.addressLine1 === 'string' || typeof entry.addressLine2 === 'string') {
    extractUnitHints(entry.addressLine1 ?? '', entry.addressLine2 ?? '').forEach((hint) => {
      if (hint) {
        hints.add(hint);
      }
    });
  }
  return Array.from(hints);
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

function stripParentheticalSegments(value) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return '';
    }
    value = String(value);
  }
  return value.replace(/\([^)]*\)/g, ' ');
}

function normaliseStreetValue(value) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return '';
    }
    value = String(value);
  }
  const expanded = expandStreetAbbreviations(value);
  const withoutParens = stripParentheticalSegments(expanded);
  const preliminary = withoutParens
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (STREET_IGNORE_TOKENS.has(token)) {
        return '';
      }
      let normalized = STREET_ALIAS_MAP.get(token) ?? token;
      if (/^[0-9]+$/.test(normalized)) {
        const numericValue = Number.parseInt(normalized, 10);
        if (!Number.isNaN(numericValue)) {
          normalized = String(numericValue);
        }
      }
      return normalized;
    })
    .filter(Boolean);

  const tokens = [];
  let numericSeen = false;
  preliminary.forEach((token) => {
    if (!token) {
      return;
    }
    const isNumeric = /^[0-9]+$/.test(token);
    if (STREET_DIRECTION_TOKENS.has(token) && numericSeen) {
      return;
    }
    tokens.push(token);
    if (isNumeric) {
      numericSeen = true;
    }
  });

  while (tokens.length > 0 && STREET_DIRECTION_TOKENS.has(tokens[0])) {
    tokens.shift();
  }

  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (STREET_SUFFIX_TOKENS.has(last)) {
      tokens.pop();
    }
  }

  return tokens.join('');
}

function extractComplexHintTokens(value) {
  if (typeof value !== 'string') {
    return [];
  }
  const beforeComma = value.split(',')[0] ?? value;
  const beforeUnit = beforeComma.split(/unit|apt|suite|ste/i)[0];
  return tokeniseString(beforeUnit).filter((token) => token.length > 1);
}

function getStreetSuffixToken(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  const expanded = expandStreetAbbreviations(value);
  const withoutParens = stripParentheticalSegments(expanded);
  const tokens = withoutParens
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_ALIAS_MAP.get(token) ?? token);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (STREET_SUFFIX_TOKENS.has(token)) {
      return token;
    }
  }
  return '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyKnownTypoCorrections(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value ?? '';
  }
  let corrected = value;
  TYPO_CORRECTIONS.forEach((replacement, typo) => {
    const pattern = new RegExp(`\\b${escapeRegExp(typo)}\\b`, 'gi');
    corrected = corrected.replace(pattern, (match) => {
      if (match === match.toUpperCase()) {
        return replacement.toUpperCase();
      }
      if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  });
  return corrected;
}

function tokeniseString(value) {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return [];
    }
    value = String(value);
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function extractBuildingCodesFromUnitKeys(unitKeys) {
  const codes = new Set();
  unitKeys.forEach((key) => {
    const match = key.match(/^([a-z]+)[0-9]+$/);
    if (match && match[1]) {
      codes.add(match[1]);
    }
  });
  return codes;
}

function extractBuildingCodesFromText(value) {
  const codes = new Set();
  if (typeof value !== 'string') {
    return codes;
  }
  const regex = /\b(?:bldg|building)\s*([A-Za-z]+)/gi;
  let match = regex.exec(value);
  while (match) {
    const code = match[1]?.toLowerCase();
    if (code) {
      codes.add(code);
    }
    match = regex.exec(value);
  }
  return codes;
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
  const seenPositions = new Set();
  const seenAddresses = new Set();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rawAddressLine1 = sanitiseLine(row[addressLine1Index]);
    if (!rawAddressLine1) {
      continue;
    }
    const initialRawAddressLine2 =
      addressLine2Index === null ? '' : sanitiseLine(row[addressLine2Index]);
    const addressLine1 = applyKnownTypoCorrections(rawAddressLine1);
    let addressLine2 = applyKnownTypoCorrections(initialRawAddressLine2);
    const skipIndexes = new Set([numberIndex, addressLine1Index]);
    if (addressLine2Index !== null) {
      skipIndexes.add(addressLine2Index);
    }
    const overflowLine = findOverflowAddressLine(row, skipIndexes);
    if (overflowLine) {
      const correctedOverflow = applyKnownTypoCorrections(overflowLine);
      if (!addressLine2) {
        addressLine2 = correctedOverflow;
      } else if (
        correctedOverflow &&
        !addressLine2.toLowerCase().includes(correctedOverflow.toLowerCase())
      ) {
        addressLine2 = `${addressLine2}; ${correctedOverflow}`;
      }
    }
    const positionValueRaw = numberIndex === null ? '' : sanitiseLine(row[numberIndex]);
    let positionValue = Number.parseInt(positionValueRaw, 10);

    if (!Number.isNaN(positionValue)) {
      const positionKey = `${waitlistType}|${positionValue}`;
      if (seenPositions.has(positionKey)) {
        positionValue = NaN; // Force to null later
      } else {
        seenPositions.add(positionKey);
      }
    }

    const id = randomUUID();
    const normalizedLine1 = normaliseAddressPart(addressLine1);
    const normalizedLine2 = normaliseAddressPart(addressLine2);
    const normalizedAddress = buildNormalisedAddress(addressLine1, addressLine2);

    const addressKey = `${waitlistType}|${normalizedAddress}`;
    if (seenAddresses.has(addressKey)) {
      console.warn(
        `[parse] Skipping duplicate address for ${label} at row ${rowIndex + 1} in ${sourceFilename}: "${rawAddressLine1}"`,
      );
      continue;
    }
    seenAddresses.add(addressKey);

    const line1Stripped = stripUnitDesignators(addressLine1);
    const normalizedLine1StrippedRaw = normaliseAddressPart(line1Stripped);
    const normalizedLine1Stripped = normalizedLine1StrippedRaw || normalizedLine1;
    const unitKeys = extractUnitHints(addressLine1, addressLine2);
    const streetUnitKeys = unitKeys
      .map((unitKey) => buildStreetUnitKey(normalizedLine1Stripped, unitKey))
      .filter((key) => key.length > 0);
    const streetCanonical = normaliseStreetValue(addressLine1);
    const streetCanonicalStripped = normaliseStreetValue(line1Stripped || addressLine1);
    const complexHintTokens = extractComplexHintTokens(addressLine2);
    const buildingCodeSet = extractBuildingCodesFromUnitKeys(unitKeys);
    extractBuildingCodesFromText(addressLine1).forEach((code) => buildingCodeSet.add(code));
    extractBuildingCodesFromText(addressLine2).forEach((code) => buildingCodeSet.add(code));
    const buildingCodes = Array.from(buildingCodeSet);
    const streetSuffix = getStreetSuffixToken(addressLine1);

    entries.push({
      id,
      waitlistType,
      waitlistLabel: label,
      position: Number.isNaN(positionValue) ? null : positionValue,
      addressLine1: rawAddressLine1,
      addressLine2: addressLine2 || '',
      normalizedLine1,
      normalizedLine2,
      normalizedLine1Stripped,
      normalizedAddress,
      unitKeys,
      streetUnitKeys,
      streetCanonical,
      streetCanonicalStripped,
      complexHintTokens,
      buildingCodes,
      streetSuffix,
      sourceFilename,
      sourceRowNumber: rowIndex + 1,
      raw: {
        number: positionValueRaw || null,
        addressLine1: rawAddressLine1,
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
    'complex',
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
    mailingStreetCanonical: new Map(),
    physicalPrimary: new Map(),
    physicalStreet: new Map(),
    physicalStreetCanonical: new Map(),
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
    pushToMap(indexes.mailingStreetCanonical, enriched.mailingStreetCanonical, enriched);
    pushToMap(indexes.physicalPrimary, enriched.physicalPrimary, enriched);
    pushToMap(indexes.physicalStreet, enriched.physicalStreetKey, enriched);
    pushToMap(indexes.physicalStreetCanonical, enriched.physicalStreetCanonical, enriched);
    if (
      enriched.physicalPrimaryCanonical &&
      enriched.physicalPrimaryCanonical !== enriched.physicalStreetCanonical
    ) {
      pushToMap(indexes.physicalStreetCanonical, enriched.physicalPrimaryCanonical, enriched);
    }
    pushToMap(indexes.streetUnit, enriched.streetUnitKey, enriched);
  });

  return indexes;
}

function enrichListingForMatching(listing) {
  const mailingLine1 = sanitiseLine(listing.mailing_address_line1);
  const mailingLine2 = sanitiseLine(listing.mailing_address_line2);
  const correctedMailingLine1 = applyKnownTypoCorrections(mailingLine1);
  const correctedMailingLine2 = applyKnownTypoCorrections(mailingLine2);
  const normalizedMailingLine1 = normaliseAddressPart(correctedMailingLine1);
  const normalizedMailingAddress =
    normalizedMailingLine1.length > 0
      ? buildNormalisedAddress(correctedMailingLine1, correctedMailingLine2)
      : '';
  const mailingStreetCanonical = normaliseStreetValue(correctedMailingLine1);

  const physicalAddressRaw = typeof listing.physical_address === 'string' ? listing.physical_address : '';
  const correctedPhysicalAddress = applyKnownTypoCorrections(physicalAddressRaw);
  const physicalPrimaryLine = extractPrimaryAddressLine(correctedPhysicalAddress);
  const correctedPhysicalPrimaryLine = applyKnownTypoCorrections(physicalPrimaryLine);
  const physicalPrimary = normaliseAddressPart(correctedPhysicalPrimaryLine);
  const physicalStreetRaw = stripUnitDesignators(correctedPhysicalPrimaryLine);
  const physicalStreetKey = normaliseAddressPart(physicalStreetRaw) || physicalPrimary;
  const physicalPrimaryCanonical = normaliseStreetValue(correctedPhysicalPrimaryLine);
  const physicalStreetCanonical = normaliseStreetValue(
    physicalStreetRaw || correctedPhysicalPrimaryLine,
  );
  const physicalStreetSuffix = getStreetSuffixToken(correctedPhysicalPrimaryLine);

  const unitNormalized = normaliseUnit(listing.unit_normalized ?? listing.unit ?? '');
  const unitVariantSet = new Set();
  if (unitNormalized) {
    unitVariantSet.add(unitNormalized);
  }
  const derivedUnitHints = extractUnitHints(
    listing.unit ?? '',
    listing.unit_normalized ?? '',
    correctedPhysicalAddress,
    correctedPhysicalPrimaryLine,
  );
  derivedUnitHints.forEach((hint) => {
    if (hint) {
      unitVariantSet.add(hint);
    }
  });
  const unitDigitVariantSet = new Set();
  unitVariantSet.forEach((variant) => {
    const digitsOnly = variant.replace(/[^0-9]/g, '');
    if (digitsOnly.length > 0) {
      unitDigitVariantSet.add(digitsOnly);
    }
  });
  const streetUnitKey = buildStreetUnitKey(physicalStreetKey, unitNormalized);
  const complexTokenSet = new Set(tokeniseString(listing.complex ?? ''));
  const buildingCodeSet = extractBuildingCodesFromText(correctedPhysicalAddress);

  if (
    !normalizedMailingAddress &&
    !normalizedMailingLine1 &&
    !physicalPrimary &&
    !physicalStreetKey
  ) {
    return null;
  }

  const ownerName = typeof listing.owner_name === 'string' ? listing.owner_name.trim() : '';

  const complexName = typeof listing.complex === 'string' ? listing.complex : '';

  return {
    id: listing.id,
    unitNormalized,
    normalizedMailingAddress,
    normalizedMailingLine1,
    mailingStreetCanonical,
    physicalPrimary,
    physicalStreetKey,
    physicalPrimaryCanonical,
    physicalStreetCanonical,
    streetUnitKey,
    ownerName,
    complexTokenSet,
    buildingCodeSet,
    complexName,
    mailingLine1Raw: mailingLine1,
    physicalPrimaryDisplay: correctedPhysicalPrimaryLine,
    physicalStreetSuffix,
    unitVariantSet,
    unitDigitVariantSet,
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
    firstUnmatchedEntry: null,
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
    if (!stats.firstUnmatchedEntry) {
      stats.firstUnmatchedEntry = {
        waitlistType: entry.waitlistType,
        waitlistLabel: entry.waitlistLabel,
        addressLine1: entry.addressLine1,
        addressLine2: entry.addressLine2,
        position: entry.position,
        sourceFilename: entry.sourceFilename,
        sourceRowNumber: entry.sourceRowNumber,
        attemptType: lowConfidence ? lowConfidence.attemptType : null,
        candidateCount: lowConfidence ? lowConfidence.candidateCount : 0,
        candidates: lowConfidence ? lowConfidence.candidateDetails : [],
      };
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
    {
      map: listingIndexes.mailingStreetCanonical,
      key: entry.streetCanonical,
      type: 'mailing_street',
      score: 0.94,
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
    {
      map: listingIndexes.physicalStreetCanonical,
      key: entry.streetCanonicalStripped,
      type: 'physical_street_canonical',
      score: 0.9,
    },
    {
      map: listingIndexes.physicalStreetCanonical,
      key: entry.streetCanonical,
      type: 'physical_street_canonical_full',
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
    addressLine2: entry.addressLine2,
    attemptType: attempt.type,
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    candidateListingIds: Array.isArray(candidates)
      ? candidates.slice(0, 5).map((candidate) => candidate.id)
      : [],
    unitHints: entry.unitKeys ?? [],
    buildingCodes: entry.buildingCodes ?? [],
    candidateDetails: Array.isArray(candidates)
      ? candidates.slice(0, 5).map((candidate) => ({
          listingId: candidate.id,
          ownerName: candidate.ownerName || '',
          unitNormalized: candidate.unitNormalized || '',
          complex: candidate.complexName || '',
          mailingLine1: candidate.mailingLine1Raw || '',
          physicalPrimary: candidate.physicalPrimaryDisplay || '',
        }))
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

  const derivedEntryUnitHints = ensureEntryUnitHints(entry);
  const entryNumericHints = new Set();
  const entryAlphaHints = new Set();
  const entryDigitVariants = new Set();
  derivedEntryUnitHints.forEach((unit) => {
    const normalized = normaliseUnit(unit);
    if (normalized.length === 0) {
      return;
    }
    const hasDigits = /[0-9]/.test(normalized);
    if (hasDigits) {
      entryNumericHints.add(normalized);
      const normalizedDigits = normalized.replace(/[^0-9]/g, '');
      if (normalizedDigits.length > 0) {
        entryDigitVariants.add(normalizedDigits);
      }
    } else {
      entryAlphaHints.add(normalized);
    }
    const rawDigits = String(unit ?? '')
      .replace(/[^0-9]/g, '')
      .trim();
    if (rawDigits.length > 0) {
      entryDigitVariants.add(rawDigits);
    }
  });

  const hasNumericHints = entryNumericHints.size > 0 || entryDigitVariants.size > 0;
  if (hasNumericHints) {
    const unitMatches = candidates.filter((listing) => {
      const listingDigits =
        listing.unitDigitVariantSet && listing.unitDigitVariantSet.size > 0
          ? listing.unitDigitVariantSet
          : new Set();
      const listingUnits =
        listing.unitVariantSet && listing.unitVariantSet.size > 0 ? listing.unitVariantSet : new Set();
      const listingHasNumericInfo = listingDigits.size > 0 || listingUnits.size > 0;
      if (!listingHasNumericInfo) {
        return false;
      }
      const digitsArray = Array.from(listingDigits);

      for (const normalized of entryNumericHints) {
        if (listingUnits.has(normalized)) {
          return true;
        }
        const normalizedDigits = normalized.replace(/[^0-9]/g, '');
        if (normalizedDigits.length === 0) {
          continue;
        }
        if (digitsArray.some((candidateDigits) => candidateDigits === normalizedDigits)) {
          return true;
        }
        if (
          normalizedDigits.length >= 2 &&
          digitsArray.some(
            (candidateDigits) =>
              candidateDigits.length > normalizedDigits.length &&
              candidateDigits.endsWith(normalizedDigits),
          )
        ) {
          return true;
        }
      }

      if (entryDigitVariants.size > 0 && digitsArray.length > 0) {
        for (const entryDigits of entryDigitVariants) {
          if (entryDigits.length === 0) {
            continue;
          }
          if (digitsArray.some((candidateDigits) => candidateDigits === entryDigits)) {
            return true;
          }
          if (
            entryDigits.length >= 2 &&
            digitsArray.some(
              (candidateDigits) =>
                candidateDigits.length > entryDigits.length &&
                candidateDigits.endsWith(entryDigits),
            )
          ) {
            return true;
          }
        }
      }

      return false;
    });
    if (unitMatches.length === 1) {
      return unitMatches[0];
    }
    if (unitMatches.length > 0) {
      candidates = unitMatches;
    }
  }

  if (hasNumericHints && candidates.length > 1) {
    const entryUnitText =
      typeof entry.addressLine2 === 'string' && entry.addressLine2.trim().length > 0
        ? entry.addressLine2.trim().toLowerCase()
        : '';
    const digitsToMatch = Array.from(entryDigitVariants).filter((digits) => digits.length > 0);
    if (entryUnitText.length > 0 || digitsToMatch.length > 0) {
      const fuzzyMatches = candidates.filter((listing) => {
        const physicalText = (listing.physicalPrimaryDisplay || '').toLowerCase();
        if (!physicalText) {
          return false;
        }
        if (entryUnitText && physicalText.includes(entryUnitText)) {
          return true;
        }
        return digitsToMatch.some((digits) => {
          const unitToken = `unit ${digits.toLowerCase()}`;
          const unitHashToken = `unit #${digits.toLowerCase()}`;
          return (
            physicalText.includes(unitToken) ||
            physicalText.includes(unitHashToken) ||
            physicalText.includes(`unit${digits.toLowerCase()}`) ||
            physicalText.includes(`unit-${digits.toLowerCase()}`)
          );
        });
      });
      if (fuzzyMatches.length === 1) {
        return fuzzyMatches[0];
      }
      if (fuzzyMatches.length > 0) {
        candidates = fuzzyMatches;
      }
    }
  }

  if (!hasNumericHints && entryAlphaHints.size > 0) {
    const alphaMatches = candidates.filter((listing) => {
      if (!listing.unitVariantSet || listing.unitVariantSet.size === 0) {
        return false;
      }
      for (const alphaHint of entryAlphaHints) {
        if (listing.unitVariantSet.has(alphaHint)) {
          return true;
        }
      }
      return false;
    });
    if (alphaMatches.length === 1) {
      return alphaMatches[0];
    }
    if (alphaMatches.length > 0) {
      candidates = alphaMatches;
    }
  }

  if (!hasNumericHints && entryAlphaHints.size === 0) {
    const noUnitCandidates = candidates.filter(
      (listing) =>
        (!listing.unitVariantSet || listing.unitVariantSet.size === 0) &&
        (!listing.unitDigitVariantSet || listing.unitDigitVariantSet.size === 0),
    );
    if (noUnitCandidates.length === 1) {
      return noUnitCandidates[0];
    }
    if (noUnitCandidates.length > 0) {
      candidates = noUnitCandidates;
    }
  }

  const entryStreetSuffix =
    typeof entry.streetSuffix === 'string' && entry.streetSuffix.length > 0
      ? entry.streetSuffix
      : getStreetSuffixToken(entry.addressLine1 || '');
  if (entryStreetSuffix) {
    const suffixMatches = candidates.filter(
      (listing) => listing.physicalStreetSuffix === entryStreetSuffix,
    );
    if (suffixMatches.length === 1) {
      return suffixMatches[0];
    }
    if (suffixMatches.length > 0) {
      candidates = suffixMatches;
    }
  }

  const buildingCodeSet =
    Array.isArray(entry.buildingCodes) && entry.buildingCodes.length > 0
      ? new Set(entry.buildingCodes.filter((code) => typeof code === 'string' && code.length > 0))
      : null;
  if (buildingCodeSet && buildingCodeSet.size > 0) {
    const buildingMatches = candidates.filter((listing) => {
      if (!listing.buildingCodeSet || listing.buildingCodeSet.size === 0) {
        return false;
      }
      for (const code of buildingCodeSet) {
        if (listing.buildingCodeSet.has(code)) {
          return true;
        }
      }
      return false;
    });
    if (buildingMatches.length === 1) {
      return buildingMatches[0];
    }
    if (buildingMatches.length > 0) {
      candidates = buildingMatches;
    }
  }

  const complexTokens = Array.isArray(entry.complexHintTokens)
    ? entry.complexHintTokens.filter((token) => token.length > 1)
    : [];
  if (complexTokens.length > 0) {
    const complexMatches = candidates.filter((listing) => {
      if (!listing.complexTokenSet || listing.complexTokenSet.size === 0) {
        return false;
      }
      return complexTokens.every((token) => listing.complexTokenSet.has(token));
    });
    if (complexMatches.length === 1) {
      return complexMatches[0];
    }
    if (complexMatches.length > 0) {
      candidates = complexMatches;
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
      const detailParts = [];
      if (typeof sample.addressLine2 === 'string' && sample.addressLine2.trim().length > 0) {
        detailParts.push(sample.addressLine2.trim());
      }
      if (Array.isArray(sample.buildingCodes) && sample.buildingCodes.length > 0) {
        detailParts.push(`bldg=${sample.buildingCodes.join('/')}`);
      }
      if (Array.isArray(sample.unitHints) && sample.unitHints.length > 0) {
        detailParts.push(`unitHints=${sample.unitHints.join('/')}`);
      }
      const detailSuffix = detailParts.length > 0 ? ` | ${detailParts.join(' | ')}` : '';
      console.log(
        `  - ${label} → ${sample.addressLine1} (${sample.attemptType}) had ${sample.candidateCount} candidate(s) [${candidateList}]${detailSuffix}`,
      );
    });
  }
  if (stats.firstUnmatchedEntry) {
    const sample = stats.firstUnmatchedEntry;
    const label = sample.waitlistLabel || sample.waitlistType || 'waitlist';
    const detailParts = [];
    if (typeof sample.position === 'number') {
      detailParts.push(`position ${sample.position}`);
    }
    if (sample.sourceFilename) {
      const row = sample.sourceRowNumber ? `:${sample.sourceRowNumber}` : '';
      detailParts.push(`source ${sample.sourceFilename}${row}`);
    }
    if (typeof sample.addressLine2 === 'string' && sample.addressLine2.trim().length > 0) {
      detailParts.push(sample.addressLine2.trim());
    }
    const detailSuffix = detailParts.length > 0 ? ` (${detailParts.join(' | ')})` : '';
    const attemptInfo = sample.attemptType ? ` via ${sample.attemptType}` : '';
    console.log(
      `[match] First unmatched entry: ${label} → ${sample.addressLine1}${detailSuffix}${attemptInfo}`,
    );
    if (Array.isArray(sample.candidates) && sample.candidates.length > 0) {
      console.log(
        `        Candidates (${sample.candidateCount ?? sample.candidates.length} total analyzed):`,
      );
      sample.candidates.forEach((candidate, index) => {
        const owner = candidate.ownerName ? `owner=${candidate.ownerName}` : 'owner=?';
        const unit =
          candidate.unitNormalized && candidate.unitNormalized.length > 0
            ? `unit=${candidate.unitNormalized}`
            : 'unit=?';
        const complex = candidate.complex ? `complex=${candidate.complex}` : 'complex=?';
        const mailing = candidate.mailingLine1 ? `mail=${candidate.mailingLine1}` : '';
        const physical = candidate.physicalPrimary ? `phys=${candidate.physicalPrimary}` : '';
        const details = [owner, unit, complex, mailing, physical]
          .filter(Boolean)
          .join(' | ');
        console.log(
          `          ${index + 1}. ${candidate.listingId || 'listing ?'}${details ? ` | ${details}` : ''}`,
        );
      });
    }
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
