import type { ArcgisFeature, ListingAttributes, OwnerRecord } from '@/types';

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
const BR_SPLIT_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const UNIT_RE = /UNIT\s+([A-Za-z0-9\-]+)/i;
const BLDG_RE = /\bBLDG\s+([A-Za-z0-9\-]+)/i;

function decodeHtml(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  if (typeof window === 'undefined') {
    return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  const textarea = window.document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
    .trim();
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractOwnerNames(attrs: ListingAttributes): string[] {
  const htmlNames = attrs.OwnerNamesPublicHTML;
  if (typeof htmlNames !== 'string' || !htmlNames.trim()) {
    return [];
  }

  const decoded = decodeHtml(htmlNames);
  const parts = decoded
    .split(BR_SPLIT_RE)
    .map((part) => normaliseWhitespace(part.replace(TAG_RE, '')))
    .filter(Boolean);
  return parts;
}

function parseOwnerAddress(raw: unknown): {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
} {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { line1: '', line2: '', city: '', state: '', postcode: '' };
  }

  const decoded = decodeHtml(raw);
  const segments = decoded
    .split('|')
    .map((segment) => normaliseWhitespace(segment))
    .filter(Boolean);

  if (!segments.length) {
    return { line1: '', line2: '', city: '', state: '', postcode: '' };
  }

  const [line1, ...rest] = segments;
  let line2 = '';
  let cityState = '';

  if (rest.length === 1) {
    cityState = rest[0];
  } else if (rest.length >= 2) {
    line2 = rest.slice(0, rest.length - 1).join(' ');
    cityState = rest[rest.length - 1];
  }

  let city = '';
  let state = '';
  let postcode = '';

  if (cityState) {
    if (cityState.includes(',')) {
      const [cityPart, remainder] = cityState.split(',', 1);
      city = toTitleCase(cityPart);
      const restPart = remainder.trim();
      if (restPart) {
        const tokens = restPart.split(/\s+/);
        if (tokens.length) {
          state = tokens[0].toUpperCase();
          postcode = tokens.slice(1).join(' ');
        }
      }
    } else {
      city = toTitleCase(cityState);
    }
  }

  return { line1, line2, city, state, postcode };
}

function normalizeComplexName(attrs: ListingAttributes): string {
  const subdivisionRaw = typeof attrs.SubdivisionName === 'string' ? attrs.SubdivisionName : '';
  let subdivision = toTitleCase(subdivisionRaw);
  if (subdivision) {
    const suffixes = [' Condo', ' Condos', ' Condominiums', ' Townhomes', ' Townhome', ' Pud', ' Filing', ' Phase'];
    for (const suffix of suffixes) {
      if (subdivision.endsWith(suffix)) {
        subdivision = subdivision.slice(0, -suffix.length).trim();
        break;
      }
    }
    if (subdivision === 'Mountain Thunder Lodge') {
      subdivision = 'Mountain Thunder';
    }
    return subdivision;
  }

  const situsRaw = (attrs.SitusAddress ?? attrs.BriefPropertyDescription) as string | undefined;
  if (!situsRaw) {
    return '';
  }

  const parts = situsRaw.split(/\s+/);
  const trimmed: string[] = [];
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (/^\d+$/.test(part) && trimmed.length === 0) {
      continue;
    }
    if (['UNIT', 'BLDG', 'BUILDING'].includes(upper)) {
      break;
    }
    trimmed.push(part);
  }

  if (trimmed.length) {
    return toTitleCase(trimmed.join(' '));
  }

  return toTitleCase(situsRaw);
}

function extractUnit(attrs: ListingAttributes): string {
  const candidates = [attrs.BriefPropertyDescription, attrs.SitusAddress];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const unitMatch = candidate.match(UNIT_RE);
    if (unitMatch) {
      return unitMatch[1];
    }
    const bldgMatch = candidate.match(BLDG_RE);
    if (bldgMatch) {
      return bldgMatch[1];
    }
  }
  return '';
}

interface SplitOwnerNameResult {
  first: string;
  middle: string;
  last: string;
  suffix: string;
  title: string;
  company: string;
}

function splitOwnerName(rawName: string): SplitOwnerNameResult {
  const clean = normaliseWhitespace(rawName.replace(/^[,\s]+|[,\s]+$/g, ''));
  if (!clean) {
    return { first: '', middle: '', last: '', suffix: '', title: '', company: '' };
  }

  const upper = clean.toUpperCase();
  if (BUSINESS_KEYWORDS.some((keyword) => upper.includes(keyword))) {
    return { first: '', middle: '', last: '', suffix: '', title: '', company: clean };
  }

  const tokens = clean.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { first: '', middle: '', last: '', suffix: '', title: '', company: '' };
  }

  let suffix = '';
  if (SUFFIX_TOKENS.has(tokens[tokens.length - 1].toUpperCase())) {
    suffix = tokens.pop() ?? '';
  }

  if (!tokens.length) {
    return { first: '', middle: '', last: '', suffix, title: '', company: '' };
  }

  if (tokens.length === 1) {
    return { first: '', middle: '', last: toTitleCase(tokens[0]), suffix, title: '', company: '' };
  }

  const firstMiddle = tokens.slice(0, -1);
  const last = toTitleCase(tokens[tokens.length - 1]);

  let first = '';
  let middle = '';

  if (firstMiddle.some((token) => ['&', 'AND'].includes(token.toUpperCase()))) {
    first = firstMiddle.map((token) => toTitleCase(token)).join(' ');
  } else {
    first = toTitleCase(firstMiddle[0]);
    if (firstMiddle.length > 1) {
      middle = firstMiddle.slice(1).map((token) => toTitleCase(token)).join(' ');
    }
  }

  return { first, middle, last, suffix, title: '', company: '' };
}

function aggregateOwnerName({
  first,
  middle,
  last,
  suffix,
  title,
  company,
}: SplitOwnerNameResult): string {
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
    const trimmedSuffix = suffix.trim();
    if (parts.length) {
      const lastIndex = parts.length - 1;
      parts[lastIndex] = `${parts[lastIndex]} ${trimmedSuffix}`.trim();
    } else {
      parts.push(trimmedSuffix);
    }
  }

  return parts.join(' ').trim();
}

function normaliseString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

function buildPublicDetailUrl(detailId: string): string {
  if (!detailId) {
    return '';
  }
  return `https://gis.summitcountyco.gov/map/DetailData.aspx?Schno=${encodeURIComponent(detailId)}`;
}

export function formatOwnerRecords(
  features: Array<ArcgisFeature<ListingAttributes>>,
): OwnerRecord[] {
  const records: OwnerRecord[] = [];

  features.forEach((feature, featureIndex) => {
    const attrs = feature.attributes ?? {};
    let ownerNames = extractOwnerNames(attrs);
    if (!ownerNames.length) {
      const fallback = normaliseString(attrs.OwnerFullName);
      ownerNames = fallback ? [fallback] : [''];
    }

    const { line1, line2, city, state, postcode } = parseOwnerAddress(attrs.OwnerContactPublicMailingAddr);
    const complexName = normalizeComplexName(attrs);
    const unit = normaliseString(attrs.PropertyUnit ?? attrs.Unit ?? extractUnit(attrs));
    const scheduleNumber = normaliseString(attrs.PropertyScheduleText);
    const detailId = normaliseString(attrs.HC_RegistrationsOriginalCleaned) || scheduleNumber;
    const physicalAddress = normaliseString(attrs.SitusAddress) || normaliseString(attrs.BriefPropertyDescription);
    const subdivision = normaliseString(attrs.SubdivisionName);

    ownerNames.forEach((rawName, index) => {
      const split = splitOwnerName(rawName);
      const ownerName = aggregateOwnerName(split);
      const isBusiness = Boolean(split.company.trim());
      const zipCode = normaliseString(postcode);
      const zip5 = zipCode.split('-')[0]?.trim() ?? '';
      const lines: string[] = [];
      if (line1) {
        lines.push(line1);
      }
      if (line2) {
        lines.push(line2);
      }
      const cityLineParts: string[] = [];
      if (city) {
        cityLineParts.push(city);
      }
      if (state) {
        cityLineParts.push(state);
      }
      const zipLine = zipCode || zip5;
      if (zipLine) {
        cityLineParts.push(zipLine);
      }
      if (cityLineParts.length) {
        lines.push(cityLineParts.join(' ').trim());
      }

      records.push({
        id: `${scheduleNumber || featureIndex}-${index}`,
        complex: complexName,
        unit,
        ownerName,
        ownerLink: null,
        businessOwner: isBusiness,
        mailingAddress: lines.join('\n'),
        addressLine1: line1,
        addressLine2: line2,
        city,
        state,
        zip5,
        zip9: zipCode,
        subdivision,
        scheduleNumber,
        publicDetailUrl: buildPublicDetailUrl(detailId),
        physicalAddress,
        firstName: split.first,
        middleName: split.middle,
        lastName: split.last,
        suffix: split.suffix,
        title: split.title,
        company: split.company,
        originalZip: zipCode,
        comments: '',
        raw: attrs,
      });
    });
  });

  return records;
}

export default formatOwnerRecords;
