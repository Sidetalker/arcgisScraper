import { decode } from 'html-entities';
import { Feature } from './arcgisClient';

type Attributes = Record<string, unknown>;

export type OwnerAttributes = Record<string, string>;

export interface OwnerTableOptions {
  docId?: string;
  complexGid?: string;
  ownerGid?: string;
}

interface OwnerPropertyLink {
  rowIndex: number;
  complex: string;
  unit: string;
  schedule: string;
  linkLabel?: string;
  ownerRow?: number;
  ownerUrl?: string;
  complexRow?: number;
  complexUrl?: string;
}

interface OwnerEntry {
  ownerId: string;
  first: string;
  middle: string;
  last: string;
  suffix: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip5: string;
  zip9: string;
  name: string;
  mailing: string;
  business: string;
  properties: OwnerPropertyLink[];
  excelRow?: number;
  ownerUrl?: string;
}

const NAME_FIELD = 'Owner Name';
const COMPANY_FIELD = 'Company (Required if last name is not provided)';

export const IMPORTANT_COLUMNS = [
  'Complex',
  'Unit',
  NAME_FIELD,
  'Owner Link',
  'Business Owner?',
  'Mailing Address',
  'Address Line 1',
  'Address Line 2',
  'City (Required)',
  'State',
  'Zip5',
  'Zip9',
  'Subdivision',
  'Schedule Number',
  'Public Detail URL',
  'Physical Address',
] as const;

export const SUPPLEMENTAL_COLUMNS = [
  'First name',
  'Middle',
  'Last Name',
  'Suffix',
  'Title',
  COMPANY_FIELD,
  'Original Zip',
  'Comments',
] as const;

export const OWNER_TABLE_COLUMNS = [...IMPORTANT_COLUMNS, ...SUPPLEMENTAL_COLUMNS] as const;

const DEFAULT_SHEETS_DOC_ID = '1kKuIBG3BQTKu3uiH3lcOg9o-fUJ79440FldeFO5gho0';
const DEFAULT_COMPLEX_GID = '2088119676';
const DEFAULT_OWNER_GID = '521649832';

const BUSINESS_KEYWORDS = [
  ' LLC',
  ' L.L.C',
  ' LLP',
  ' L.L.P',
  ' INC',
  ' CO ',
  ' COMPANY',
  ' CORPORATION',
  ' CORP',
  ' LP',
  ' L.P',
  ' LLLP',
  ' PLLC',
  ' PC',
  ' TRUST',
  ' TR ',
  ' FOUNDATION',
  ' ASSOCIATES',
  ' HOLDINGS',
  ' ENTERPRISE',
  ' ENTERPRISES',
  ' PROPERTIES',
  ' PROPERTY',
  ' GROUP',
  ' INVEST',
  ' PARTNERSHIP',
  ' PARTNERS',
  ' LIVING TRUST',
  ' REVOCABLE',
  ' FAMILY',
  ' MANAGEMENT',
  ' FUND',
  ' ESTATE',
  ' LLC.',
  ' LLC,',
] as const;

const SUFFIX_TOKENS = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

const BR_SPLIT_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const UNIT_RE = /UNIT\s+([A-Za-z0-9\-]+)/i;
const BLDG_RE = /\bBLDG\s+([A-Za-z0-9\-]+)/i;

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function decodeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return decode(String(value));
}

function extractOwnerNames(attrs: Attributes): string[] {
  const raw = attrs['OwnerNamesPublicHTML'];
  if (!raw) {
    return [];
  }
  const decoded = decodeHtml(raw);
  const parts = decoded
    .split(BR_SPLIT_RE)
    .map((part) => part.replace(TAG_RE, ''))
    .map((part) => part.trim())
    .filter(Boolean);
  return parts;
}

function parseOwnerAddress(raw: unknown): [string, string, string, string, string] {
  const decoded = decodeHtml(raw);
  if (!decoded) {
    return ['', '', '', '', ''];
  }

  const segments = decoded
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return ['', '', '', '', ''];
  }

  let line1 = segments[0];
  let line2 = '';
  let city = '';
  let state = '';
  let postcode = '';
  let cityState = '';

  if (segments.length === 2) {
    cityState = segments[1];
  } else if (segments.length >= 3) {
    line2 = segments.slice(1, -1).join(' ');
    cityState = segments[segments.length - 1];
  }

  if (cityState) {
    const commaIndex = cityState.indexOf(',');
    if (commaIndex !== -1) {
      const cityPart = cityState.slice(0, commaIndex);
      const restPart = cityState.slice(commaIndex + 1);
      city = cityPart.trim().replace(/\s+/g, ' ');
      const rest = restPart.trim();
      if (rest) {
        const tokens = rest.split(/\s+/);
        if (tokens.length) {
          state = tokens[0].toUpperCase();
          postcode = tokens.slice(1).join(' ').trim();
        }
      }
    } else {
      city = cityState.trim();
    }
  }

  return [line1, line2, toTitleCase(city), state, postcode];
}

function toTitleCase(value: string): string {
  if (!value) {
    return '';
  }
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeComplexName(attrs: Attributes): string {
  const rawSubdivision = toStringValue(attrs['SubdivisionName']).trim();
  if (rawSubdivision) {
    let subdivision = toTitleCase(rawSubdivision);
    const suffixes = [
      ' Condo',
      ' Condos',
      ' Condominiums',
      ' Townhomes',
      ' Townhome',
      ' Pud',
      ' Filing',
      ' Phase',
    ];
    for (const suffix of suffixes) {
      if (subdivision.endsWith(suffix)) {
        subdivision = subdivision.slice(0, -suffix.length).trim();
      }
    }
    const replacements: Record<string, string> = {
      'Mountain Thunder Lodge': 'Mountain Thunder',
    };
    return replacements[subdivision] ?? subdivision;
  }

  const situs = toStringValue(attrs['SitusAddress']);
  if (!situs) {
    return '';
  }

  const parts = situs.split(/\s+/);
  const trimmed = [];
  for (const part of parts) {
    if (!trimmed.length && /^\d+$/.test(part)) {
      continue;
    }
    const upper = part.toUpperCase();
    if (upper === 'UNIT' || upper === 'BLDG' || upper === 'BUILDING') {
      break;
    }
    trimmed.push(part);
  }

  if (trimmed.length) {
    return toTitleCase(trimmed.join(' '));
  }
  return situs;
}

function extractUnit(attrs: Attributes): string {
  const candidates = [
    attrs['BriefPropertyDescription'],
    attrs['SitusAddress'],
  ];

  for (const candidate of candidates) {
    const text = toStringValue(candidate);
    if (!text) {
      continue;
    }
    const unitMatch = UNIT_RE.exec(text);
    if (unitMatch) {
      return unitMatch[1];
    }
  }

  for (const candidate of candidates) {
    const text = toStringValue(candidate);
    if (!text) {
      continue;
    }
    const buildingMatch = BLDG_RE.exec(text);
    if (buildingMatch) {
      return buildingMatch[1];
    }
  }

  return '';
}

function splitOwnerName(rawName: string): [string, string, string, string, string, string] {
  const clean = rawName.trim().replace(/,+$/, '');
  if (!clean) {
    return ['', '', '', '', '', ''];
  }

  const normalized = clean.replace(/\s+/g, ' ');
  const upper = normalized.toUpperCase();
  if (BUSINESS_KEYWORDS.some((keyword) => upper.includes(keyword))) {
    return ['', '', '', '', '', normalized];
  }

  const tokens = normalized.replace(/\./g, '').split(/\s+/);
  if (!tokens.length) {
    return ['', '', '', '', '', ''];
  }

  let suffix = '';
  if (SUFFIX_TOKENS.has(tokens[tokens.length - 1].toUpperCase())) {
    suffix = tokens.pop() ?? '';
  }

  if (!tokens.length) {
    return ['', '', '', suffix, '', ''];
  }

  if (tokens.length === 1) {
    return ['', '', toTitleCase(tokens[0]), suffix, '', ''];
  }

  const firstMiddleTokens = tokens.slice(0, -1);
  const last = toTitleCase(tokens[tokens.length - 1]);

  let first = '';
  let middle = '';

  if (firstMiddleTokens.some((token) => token.toUpperCase() === '&' || token.toUpperCase() === 'AND')) {
    first = firstMiddleTokens.map((token) => toTitleCase(token)).join(' ');
  } else {
    first = toTitleCase(firstMiddleTokens[0]);
    middle = firstMiddleTokens.slice(1).map((token) => toTitleCase(token)).join(' ');
  }

  return [first, middle, last, suffix, '', ''];
}

function aggregateOwnerName(
  first: string,
  middle: string,
  last: string,
  suffix: string,
  title: string,
  company: string,
): string {
  const trimmedCompany = company.trim();
  if (trimmedCompany) {
    return trimmedCompany;
  }

  const parts: string[] = [];
  if (title) {
    parts.push(title.trim());
  }
  if (first) {
    parts.push(first.trim());
  }
  if (middle) {
    parts.push(middle.trim());
  }
  if (last) {
    parts.push(last.trim());
  }
  if (suffix) {
    const suffixTrim = suffix.trim();
    if (parts.length) {
      const lastIndex = parts.length - 1;
      parts[lastIndex] = `${parts[lastIndex]} ${suffixTrim}`.trim();
    } else {
      parts.push(suffixTrim);
    }
  }
  return parts.join(' ').trim();
}

function unitSortKey(unit: string): [number, string] {
  if (!unit) {
    return [1, ''];
  }
  const numeric = Number(unit);
  if (Number.isNaN(numeric)) {
    return [0, unit.toLowerCase()];
  }
  return [0, numeric.toFixed(4).padStart(12, '0')];
}

function normaliseNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function buildMailingAddress(parts: string[]): string {
  return normaliseNewlines(parts.filter(Boolean).join('\n'));
}

function ownerKey(row: OwnerAttributes): string {
  const company = (row[COMPANY_FIELD] ?? '').trim().toUpperCase();
  const first = (row['First name'] ?? '').trim().toUpperCase();
  const middle = (row['Middle'] ?? '').trim().toUpperCase();
  const last = (row['Last Name'] ?? '').trim().toUpperCase();
  const suffix = (row['Suffix'] ?? '').trim().toUpperCase();
  return [company, first, middle, last, suffix].join('|');
}

function buildHyperlink(url: string, label: string): string {
  const safeLabel = label.replace(/"/g, '""');
  return `=HYPERLINK("${url}", "${safeLabel}")`;
}

function buildOwnerRegistry(rows: OwnerAttributes[]): OwnerEntry[] {
  const owners: OwnerEntry[] = [];
  const lookup = new Map<string, OwnerEntry>();

  rows.forEach((row, index) => {
    const key = ownerKey(row);
    let owner = lookup.get(key);
    if (!owner) {
      owner = {
        ownerId: `OWN${String(owners.length + 1).padStart(4, '0')}`,
        first: row['First name'] ?? '',
        middle: row['Middle'] ?? '',
        last: row['Last Name'] ?? '',
        suffix: row['Suffix'] ?? '',
        company: row[COMPANY_FIELD] ?? '',
        address1: row['Address Line 1'] ?? '',
        address2: row['Address Line 2'] ?? '',
        city: row['City (Required)'] ?? '',
        state: row['State'] ?? '',
        zip5: row['Zip5'] ?? '',
        zip9: row['Zip9'] ?? '',
        name: row[NAME_FIELD] ?? '',
        mailing: row['Mailing Address'] ?? '',
        business: row['Business Owner?'] ?? '',
        properties: [],
      };
      owners.push(owner);
      lookup.set(key, owner);
    }

    owner.properties.push({
      rowIndex: index,
      complex: row['Complex'] ?? '',
      unit: row['Unit'] ?? '',
      schedule: row['Schedule Number'] ?? '',
    });
  });

  return owners;
}

function applyHyperlinkUrls(
  rows: OwnerAttributes[],
  owners: OwnerEntry[],
  options: OwnerTableOptions,
): void {
  const docId = options.docId ?? DEFAULT_SHEETS_DOC_ID;
  const complexGid = options.complexGid ?? DEFAULT_COMPLEX_GID;
  const ownerGid = options.ownerGid ?? DEFAULT_OWNER_GID;

  let currentRow = 2;
  owners.forEach((owner) => {
    owner.excelRow = currentRow;
    const ownerUrl = `https://docs.google.com/spreadsheets/d/${docId}/edit#gid=${ownerGid}&range=B${currentRow}`;
    owner.ownerUrl = ownerUrl;

    owner.properties.forEach((property) => {
      const complexRow = property.rowIndex + 2;
      const complexUrl = `https://docs.google.com/spreadsheets/d/${docId}/edit#gid=${complexGid}&range=A${complexRow}`;
      const labelParts = [property.complex, property.unit];
      if (!property.unit && property.schedule) {
        labelParts.push(property.schedule);
      }

      const label = labelParts.filter(Boolean).join(' ').trim() || property.complex;
      const ownerLink = buildHyperlink(ownerUrl, owner.ownerId);
      rows[property.rowIndex]['Owner Link'] = ownerLink;
      property.ownerRow = currentRow;
      property.ownerUrl = ownerUrl;
      property.complexRow = complexRow;
      property.complexUrl = complexUrl;
      property.linkLabel = label;
    });

    currentRow += owner.properties.length;
  });
}

export function formatOwnerTableFeatures(
  features: Feature<Attributes>[],
  options: OwnerTableOptions = {},
): Feature<OwnerAttributes>[] {
  const rows: { attributes: OwnerAttributes; geometry?: Feature['geometry'] }[] = [];
  let rowCounter = 1;

  features.forEach((feature) => {
    const attrs = feature.attributes ?? {};
    const ownerNames = extractOwnerNames(attrs);
    const rawNames = ownerNames.length ? ownerNames : [toStringValue(attrs['OwnerFullName']).trim()];
    const [address1, address2, city, state, postcode] = parseOwnerAddress(attrs['OwnerContactPublicMailingAddr']);
    const complexName = normalizeComplexName(attrs);
    const unit = extractUnit(attrs);
    const scheduleNumber = toStringValue(attrs['PropertyScheduleText']).trim();
    const detailId = toStringValue(attrs['HC_RegistrationsOriginalCleaned']).trim() || scheduleNumber;
    const detailUrl = detailId
      ? `https://gis.summitcountyco.gov/map/DetailData.aspx?Schno=${detailId}`
      : '';
    const subdivision = toStringValue(attrs['SubdivisionName']).trim();
    const physicalAddress =
      toStringValue(attrs['SitusAddress']).trim() ||
      toStringValue(attrs['BriefPropertyDescription']).trim();

    const zipCode = postcode.trim();
    const zip5 = zipCode.split('-')[0]?.trim() ?? '';

    const cityLine = city && state ? `${city}, ${state}` : city || state;
    const zipForLine = zipCode || zip5;

    const mailingLines = [
      address1,
      address2,
      [cityLine, zipForLine].filter(Boolean).join(' ').trim(),
    ].filter(Boolean);
    const mailingAddress = buildMailingAddress(mailingLines);

    rawNames.forEach((rawName) => {
      const [first, middle, last, suffix, title, company] = splitOwnerName(rawName);
      const ownerName = aggregateOwnerName(first, middle, last, suffix, title, company);
      const isBusiness = company.trim() ? 'Yes' : 'No';
      const row: OwnerAttributes = {
        __rowId: `row-${rowCounter++}`,
        Complex: complexName,
        Unit: unit,
        [NAME_FIELD]: ownerName || rawName || '',
        'Owner Link': '',
        'Business Owner?': isBusiness,
        'Mailing Address': mailingAddress,
        'Address Line 1': address1,
        'Address Line 2': address2,
        'City (Required)': city,
        State: state,
        Zip5: zip5,
        Zip9: zipCode,
        Subdivision: subdivision,
        'Schedule Number': scheduleNumber,
        'Public Detail URL': detailUrl,
        'Physical Address': physicalAddress,
        'First name': first,
        Middle: middle,
        'Last Name': last,
        Suffix: suffix,
        Title: title,
        [COMPANY_FIELD]: company,
        'Original Zip': postcode,
        Comments: '',
      };

      rows.push({
        attributes: row,
        geometry: feature.geometry ?? undefined,
      });
    });
  });

  rows.sort((a, b) => {
    const complexA = (a.attributes['Complex'] ?? '').toLowerCase();
    const complexB = (b.attributes['Complex'] ?? '').toLowerCase();
    if (complexA < complexB) return -1;
    if (complexA > complexB) return 1;
    const [flagA, keyA] = unitSortKey(a.attributes['Unit'] ?? '');
    const [flagB, keyB] = unitSortKey(b.attributes['Unit'] ?? '');
    if (flagA !== flagB) {
      return flagA - flagB;
    }
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  });

  const rowAttributes = rows.map((row) => row.attributes);
  const owners = buildOwnerRegistry(rowAttributes);
  applyHyperlinkUrls(rowAttributes, owners, options);

  return rows.map((row) => ({
    attributes: row.attributes,
    geometry: row.geometry,
  }));
}

export function createOwnerFieldDefinitions(): { name: string; type: string; alias: string }[] {
  return OWNER_TABLE_COLUMNS.map((column) => ({
    name: column,
    type: 'string',
    alias: column,
  }));
}
