import type { ArcgisFeature } from '@/types';
import type { ListingAttributes, ListingFilters, ListingRecord } from '@/types';

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
];

const SUFFIX_TOKENS = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
const UNIT_RE = /UNIT\s+([A-Za-z0-9\-]+)/i;
const BLDG_RE = /\bBLDG\s+([A-Za-z0-9\-]+)/i;
const BREAK_PLACEHOLDER = '|||BREAK|||';

function decodeHtml(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<span>${value}</span>`, 'text/html');
    return doc.body.textContent?.trim() ?? '';
  }

  return trimmed
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split('-')
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('-'),
    )
    .join(' ');
}

function extractOwnerNames(attributes: ListingAttributes): string[] {
  const html = attributes.OwnerNamesPublicHTML;
  if (typeof html !== 'string' || !html.trim()) {
    return [];
  }

  const prepared = html.replace(/<br\s*\/?>(\s*)/gi, `${BREAK_PLACEHOLDER}$1`);
  const decoded = decodeHtml(prepared);
  return decoded
    .split(BREAK_PLACEHOLDER)
    .map((part) => part.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseOwnerAddress(raw: unknown): {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
} {
  if (typeof raw !== 'string') {
    return { line1: '', line2: '', city: '', state: '', postcode: '' };
  }

  const prepared = raw.replace(/<br\s*\/?>(\s*)/gi, `|$1`);
  const decoded = decodeHtml(prepared);
  const segments = decoded
    .split('|')
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { line1: '', line2: '', city: '', state: '', postcode: '' };
  }

  const line1 = segments[0];
  let line2 = '';
  let cityState = '';

  if (segments.length === 2) {
    cityState = segments[1];
  } else if (segments.length >= 3) {
    line2 = segments.slice(1, -1).join(' ');
    cityState = segments[segments.length - 1];
  }

  let city = '';
  let state = '';
  let postcode = '';

  if (cityState) {
    if (cityState.includes(',')) {
      const [cityPart, ...restParts] = cityState.split(',');
      city = titleCase(cityPart.trim());
      const remainder = restParts.join(',').trim();
      if (remainder) {
        const tokens = remainder.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) {
          state = tokens[0].toUpperCase();
          postcode = tokens.slice(1).join(' ').trim();
        }
      }
    } else {
      city = titleCase(cityState);
    }
  }

  return { line1, line2, city, state, postcode };
}

type OwnerParts = {
  first: string;
  middle: string;
  last: string;
  suffix: string;
  title: string;
  company: string;
};

function splitOwnerName(rawName: string): OwnerParts {
  const clean = rawName.trim().replace(/,+$/, '');
  if (!clean) {
    return { first: '', middle: '', last: '', suffix: '', title: '', company: '' };
  }

  if (BUSINESS_KEYWORDS.some((keyword) => clean.toUpperCase().includes(keyword))) {
    return { first: '', middle: '', last: '', suffix: '', title: '', company: clean.trim() };
  }

  const rawTokens = clean.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) {
    return { first: '', middle: '', last: '', suffix: '', title: '', company: '' };
  }

  let tokens = [...rawTokens];
  let suffix = '';
  if (tokens.length && SUFFIX_TOKENS.has(tokens[tokens.length - 1].toUpperCase())) {
    suffix = tokens.pop() ?? '';
  }

  if (tokens.length === 0) {
    return { first: '', middle: '', last: '', suffix, title: '', company: '' };
  }

  if (tokens.length === 1) {
    return { first: '', middle: '', last: titleCase(tokens[0]), suffix, title: '', company: '' };
  }

  const lastToken = tokens[tokens.length - 1];
  const firstMiddle = tokens.slice(0, -1);
  const usesConnector = firstMiddle.some((token) => {
    const upperToken = token.toUpperCase();
    return upperToken === '&' || upperToken === 'AND';
  });

  let first = '';
  let middle = '';

  if (usesConnector) {
    first = firstMiddle.map((token) => titleCase(token)).join(' ');
  } else {
    first = titleCase(firstMiddle[0]);
    if (firstMiddle.length > 1) {
      middle = firstMiddle
        .slice(1)
        .map((token) => titleCase(token))
        .join(' ');
    }
  }

  const last = titleCase(lastToken);

  return { first, middle, last, suffix, title: '', company: '' };
}

function aggregateOwnerName(parts: OwnerParts): string {
  const company = parts.company.trim();
  if (company) {
    return company;
  }

  const components: string[] = [];
  if (parts.title) {
    components.push(parts.title.trim());
  }
  if (parts.first) {
    components.push(parts.first.trim());
  }
  if (parts.middle) {
    components.push(parts.middle.trim());
  }
  if (parts.last) {
    const lastPart = parts.suffix ? `${parts.last.trim()} ${parts.suffix.trim()}`.trim() : parts.last.trim();
    components.push(lastPart);
  } else if (parts.suffix) {
    components.push(parts.suffix.trim());
  }

  return components.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeComplexName(attributes: ListingAttributes): string {
  const rawSubdivision = attributes.SubdivisionName;
  if (typeof rawSubdivision === 'string' && rawSubdivision.trim()) {
    let subdivision = titleCase(rawSubdivision.trim());
    const suffixes = [' Condo', ' Condos', ' Condominiums', ' Townhomes', ' Townhome', ' Pud', ' Filing', ' Phase'];
    for (const suffix of suffixes) {
      if (subdivision.endsWith(suffix)) {
        subdivision = subdivision.slice(0, -suffix.length).trim();
        break;
      }
    }

    const replacements: Record<string, string> = {
      'Mountain Thunder Lodge': 'Mountain Thunder',
    };
    return replacements[subdivision] ?? subdivision;
  }

  const situs = typeof attributes.SitusAddress === 'string' ? attributes.SitusAddress : '';
  if (!situs) {
    return '';
  }

  const parts = situs.split(/\s+/).filter(Boolean);
  if (parts.length && /^\d+$/.test(parts[0])) {
    parts.shift();
  }

  const trimmed: string[] = [];
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === 'UNIT' || upper === 'BLDG' || upper === 'BUILDING') {
      break;
    }
    trimmed.push(part);
  }

  if (trimmed.length === 0) {
    return situs.trim();
  }

  return titleCase(trimmed.join(' '));
}

function extractUnit(attributes: ListingAttributes): string {
  const candidates = [attributes.BriefPropertyDescription, attributes.SitusAddress];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const match = candidate.match(UNIT_RE);
    if (match) {
      return match[1];
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const match = candidate.match(BLDG_RE);
    if (match) {
      return match[1];
    }
  }
  return '';
}

function formatCityStateZip(city: string, state: string, postcode: string): string {
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = postcode.trim();

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

function buildDetailUrl(detailId: string): string {
  if (!detailId) {
    return '';
  }
  const encoded = encodeURIComponent(detailId);
  return `https://gis.summitcountyco.gov/map/DetailData.aspx?Schno=${encoded}`;
}

export function toListingRecord(
  feature: ArcgisFeature<ListingAttributes>,
  index: number,
): ListingRecord {
  const attributes = feature.attributes ?? {};

  const scheduleNumberRaw = attributes.PropertyScheduleText;
  const scheduleNumber = typeof scheduleNumberRaw === 'string' ? scheduleNumberRaw.trim() : '';
  const objectId = attributes.OBJECTID;
  const id =
    scheduleNumber ||
    (typeof objectId === 'number'
      ? objectId.toString()
      : `listing-${typeof attributes.GlobalID === 'string' ? attributes.GlobalID : index}`);

  let ownerSources = extractOwnerNames(attributes);
  if (ownerSources.length === 0) {
    const fallback = decodeHtml(attributes.OwnerFullName);
    if (fallback) {
      ownerSources = [fallback];
    }
  }

  const ownerParts = ownerSources.map((raw) => splitOwnerName(raw));
  const ownerNames = ownerParts
    .map((parts, ownerIndex) => {
      const aggregated = aggregateOwnerName(parts);
      if (aggregated) {
        return aggregated;
      }
      const fallbackSource = ownerSources[ownerIndex];
      return typeof fallbackSource === 'string' ? fallbackSource.trim() : '';
    })
    .filter((name) => name.length > 0);

  const ownerName = ownerNames.join('; ');
  const isBusinessOwner = ownerParts.some((parts) => parts.company.trim().length > 0);

  const { line1, line2, city, state, postcode } = parseOwnerAddress(
    attributes.OwnerContactPublicMailingAddr,
  );
  const zip5 = postcode ? postcode.split('-')[0].trim() : '';
  const mailingLines = [line1, line2, formatCityStateZip(city, state, postcode || zip5)];
  const mailingAddress = mailingLines.filter(Boolean).join('\n');

  const subdivisionRaw =
    typeof attributes.SubdivisionName === 'string' ? attributes.SubdivisionName : '';
  const subdivision = subdivisionRaw ? titleCase(subdivisionRaw.trim()) : '';

  const detailIdRaw =
    (typeof attributes.HC_RegistrationsOriginalCleaned === 'string'
      ? attributes.HC_RegistrationsOriginalCleaned
      : null) || scheduleNumber;
  const publicDetailUrl = buildDetailUrl(detailIdRaw ?? '');

  const physicalAddressRaw =
    (typeof attributes.SitusAddress === 'string' && attributes.SitusAddress.trim()) ||
    (typeof attributes.BriefPropertyDescription === 'string' &&
      attributes.BriefPropertyDescription.trim()) ||
    '';

  return {
    id,
    complex: normalizeComplexName(attributes),
    unit: extractUnit(attributes),
    ownerName,
    ownerNames,
    mailingAddress,
    mailingAddressLine1: line1,
    mailingAddressLine2: line2,
    mailingCity: city,
    mailingState: state,
    mailingZip5: zip5,
    mailingZip9: postcode,
    subdivision,
    scheduleNumber,
    publicDetailUrl,
    physicalAddress: physicalAddressRaw,
    isBusinessOwner,
    raw: attributes,
  };
}

export function applyFilters(listing: ListingRecord, filters: ListingFilters): boolean {
  const search = filters.searchTerm.trim().toLowerCase();
  if (search) {
    const haystack = [
      listing.complex,
      listing.unit,
      listing.ownerName,
      listing.physicalAddress,
      listing.scheduleNumber,
      listing.subdivision,
      listing.mailingAddress,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filters.scheduleNumber.trim()) {
    const scheduleQuery = filters.scheduleNumber.trim().toLowerCase();
    if (!listing.scheduleNumber.toLowerCase().includes(scheduleQuery)) {
      return false;
    }
  }

  if (filters.mailingCity.trim()) {
    const cityQuery = filters.mailingCity.trim().toLowerCase();
    if (!listing.mailingCity.toLowerCase().includes(cityQuery)) {
      return false;
    }
  }

  if (filters.mailingState) {
    if (listing.mailingState.toLowerCase() !== filters.mailingState.toLowerCase()) {
      return false;
    }
  }

  if (filters.mailingZip.trim()) {
    const zipQuery = filters.mailingZip.trim();
    const zip9 = listing.mailingZip9 || listing.mailingZip5;
    if (!listing.mailingZip5.startsWith(zipQuery) && !(zip9 && zip9.startsWith(zipQuery))) {
      return false;
    }
  }

  if (filters.subdivision) {
    if (
      !listing.subdivision ||
      listing.subdivision.toLowerCase() !== filters.subdivision.toLowerCase()
    ) {
      return false;
    }
  }

  if (filters.businessOwner) {
    const expected = filters.businessOwner === 'yes';
    if (listing.isBusinessOwner !== expected) {
      return false;
    }
  }

  return true;
}
