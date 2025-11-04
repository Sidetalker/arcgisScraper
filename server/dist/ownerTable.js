"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPLEMENTAL_COLUMNS = exports.IMPORTANT_COLUMNS = void 0;
exports.buildOwnerFields = buildOwnerFields;
exports.formatOwnerTable = formatOwnerTable;
exports.IMPORTANT_COLUMNS = [
    'Complex',
    'Unit',
    'Owner Name',
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
];
exports.SUPPLEMENTAL_COLUMNS = [
    'First name',
    'Middle',
    'Last Name',
    'Suffix',
    'Title',
    'Company (Required if last name is not provided)',
    'Original Zip',
    'Comments',
];
const OWNER_FIELDS = [...exports.IMPORTANT_COLUMNS, ...exports.SUPPLEMENTAL_COLUMNS];
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
const BR_SPLIT_REGEX = /<br\s*\/?>/gi;
const TAG_REGEX = /<[^>]+>/g;
const UNIT_REGEX = /UNIT\s+([A-Za-z0-9-]+)/i;
const BLDG_REGEX = /\bBLDG\s+([A-Za-z0-9-]+)/i;
function ensureString(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}
function decodeHtml(value) {
    const raw = ensureString(value);
    if (!raw) {
        return '';
    }
    return raw
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&#(\d+);/g, (_, code) => {
        const parsed = Number(code);
        return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
    })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
        const parsed = Number.parseInt(code, 16);
        return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
    });
}
function titleCase(value) {
    const lower = value.toLowerCase();
    return lower.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}
function cleanWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function extractOwnerNames(attrs) {
    const htmlNames = ensureString(attrs.OwnerNamesPublicHTML);
    if (!htmlNames) {
        return [];
    }
    const decoded = decodeHtml(htmlNames);
    return decoded
        .split(BR_SPLIT_REGEX)
        .map((part) => cleanWhitespace(part.replace(TAG_REGEX, '')))
        .filter(Boolean);
}
function parseOwnerAddress(raw) {
    const decoded = decodeHtml(raw);
    if (!decoded) {
        return { line1: '', line2: '', city: '', state: '', postcode: '' };
    }
    const segments = decoded
        .split('|')
        .map((segment) => cleanWhitespace(segment))
        .filter(Boolean);
    if (!segments.length) {
        return { line1: '', line2: '', city: '', state: '', postcode: '' };
    }
    const line1 = segments[0] ?? '';
    let line2 = '';
    let cityState = '';
    if (segments.length === 2) {
        cityState = segments[1] ?? '';
    }
    else if (segments.length >= 3) {
        line2 = segments.slice(1, -1).join(' ');
        cityState = segments[segments.length - 1] ?? '';
    }
    let city = '';
    let state = '';
    let postcode = '';
    if (cityState) {
        if (cityState.includes(',')) {
            const [cityPart, rest] = cityState.split(',', 2);
            city = titleCase(cleanWhitespace(cityPart));
            const trimmed = cleanWhitespace(rest ?? '');
            if (trimmed) {
                const tokens = trimmed.split(/\s+/);
                if (tokens.length) {
                    state = tokens[0]?.toUpperCase() ?? '';
                    postcode = tokens.slice(1).join(' ').trim();
                }
            }
        }
        else {
            city = titleCase(cityState);
        }
    }
    return { line1, line2, city, state, postcode };
}
function normalizeComplexName(attrs) {
    const subdivisionRaw = cleanWhitespace(titleCase(ensureString(attrs.SubdivisionName)));
    if (subdivisionRaw) {
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
        let name = subdivisionRaw;
        for (const suffix of suffixes) {
            if (name.endsWith(suffix)) {
                name = name.slice(0, -suffix.length).trim();
            }
        }
        const replacements = {
            'Mountain Thunder Lodge': 'Mountain Thunder',
        };
        return replacements[name] ?? name;
    }
    const situsRaw = ensureString(attrs.SitusAddress);
    if (!situsRaw) {
        return '';
    }
    const parts = situsRaw.split(/\s+/).filter(Boolean);
    const trimmed = [];
    let index = 0;
    if (parts[index] && /^\d+$/.test(parts[index])) {
        index += 1;
    }
    for (; index < parts.length; index += 1) {
        const part = parts[index];
        const upper = part.toUpperCase();
        if (upper === 'UNIT' || upper === 'BLDG' || upper === 'BUILDING') {
            break;
        }
        trimmed.push(part);
    }
    if (trimmed.length) {
        return titleCase(trimmed.join(' '));
    }
    return situsRaw;
}
function extractUnit(attrs) {
    const candidates = [attrs.BriefPropertyDescription, attrs.SitusAddress];
    for (const value of candidates) {
        const text = ensureString(value);
        if (!text) {
            continue;
        }
        const unitMatch = text.match(UNIT_REGEX);
        if (unitMatch) {
            return unitMatch[1] ?? '';
        }
    }
    for (const value of candidates) {
        const text = ensureString(value);
        if (!text) {
            continue;
        }
        const bldgMatch = text.match(BLDG_REGEX);
        if (bldgMatch) {
            return bldgMatch[1] ?? '';
        }
    }
    return '';
}
function splitOwnerName(rawName) {
    let clean = cleanWhitespace(rawName.replace(/,+$/, ''));
    if (!clean) {
        return { first: '', middle: '', last: '', suffix: '', title: '', company: '' };
    }
    clean = clean.replace(/\.+/g, '');
    const upper = clean.toUpperCase();
    if (BUSINESS_KEYWORDS.some((keyword) => upper.includes(keyword))) {
        return { first: '', middle: '', last: '', suffix: '', title: '', company: clean };
    }
    const tokens = clean.split(/\s+/);
    if (!tokens.length) {
        return { first: '', middle: '', last: '', suffix: '', title: '', company: '' };
    }
    let suffix = '';
    const lastToken = tokens[tokens.length - 1];
    if (lastToken && SUFFIX_TOKENS.has(lastToken.toUpperCase())) {
        suffix = lastToken.toUpperCase();
        tokens.pop();
    }
    if (!tokens.length) {
        return { first: '', middle: '', last: '', suffix, title: '', company: '' };
    }
    if (tokens.length === 1) {
        return {
            first: '',
            middle: '',
            last: titleCase(tokens[0]),
            suffix,
            title: '',
            company: '',
        };
    }
    const last = titleCase(tokens[tokens.length - 1]);
    const firstMiddle = tokens.slice(0, -1);
    const hasConnector = firstMiddle.some((token) => {
        const upperToken = token.toUpperCase();
        return upperToken === '&' || upperToken === 'AND';
    });
    if (hasConnector) {
        const combined = firstMiddle.map((token) => titleCase(token)).join(' ');
        return {
            first: combined,
            middle: '',
            last,
            suffix,
            title: '',
            company: '',
        };
    }
    const first = titleCase(firstMiddle[0] ?? '');
    const middle = firstMiddle
        .slice(1)
        .map((token) => titleCase(token))
        .join(' ');
    return {
        first,
        middle,
        last,
        suffix,
        title: '',
        company: '',
    };
}
function aggregateOwnerName(parts) {
    const company = cleanWhitespace(parts.company ?? '');
    if (company) {
        return company;
    }
    const segments = [];
    if (parts.title) {
        segments.push(cleanWhitespace(parts.title));
    }
    if (parts.first) {
        segments.push(cleanWhitespace(parts.first));
    }
    if (parts.middle) {
        segments.push(cleanWhitespace(parts.middle));
    }
    if (parts.last) {
        segments.push(cleanWhitespace(parts.last));
    }
    if (parts.suffix) {
        const trimmed = cleanWhitespace(parts.suffix);
        if (segments.length) {
            const last = segments.pop() ?? '';
            segments.push(`${last} ${trimmed}`.trim());
        }
        else {
            segments.push(trimmed);
        }
    }
    return cleanWhitespace(segments.join(' '));
}
function unitSortKey(unit) {
    if (!unit) {
        return [1, ''];
    }
    const numeric = Number(unit);
    if (Number.isNaN(numeric)) {
        return [0, unit.toLowerCase()];
    }
    return [0, numeric.toFixed(4).padStart(12, '0')];
}
function sanitizeValue(value) {
    return value ?? '';
}
function buildOwnerFields() {
    return OWNER_FIELDS.map((name) => ({
        name,
        type: 'esriFieldTypeString',
        alias: name,
    }));
}
function formatOwnerTable(features) {
    const rows = [];
    features.forEach((feature, index) => {
        const attrs = feature.attributes ?? {};
        const rawNames = extractOwnerNames(attrs);
        let names = rawNames;
        if (!names.length) {
            const fallback = ensureString(attrs.OwnerFullName).trim();
            names = fallback ? [fallback] : [''];
        }
        const scheduleNumber = ensureString(attrs.PropertyScheduleText);
        const detailIdentifier = ensureString(attrs.HC_RegistrationsOriginalCleaned) || scheduleNumber;
        const physicalAddress = ensureString(attrs.SitusAddress) || ensureString(attrs.BriefPropertyDescription);
        const subdivision = ensureString(attrs.SubdivisionName);
        const { line1: addressLine1, line2: addressLine2, city, state, postcode, } = parseOwnerAddress(attrs.OwnerContactPublicMailingAddr);
        const complexName = normalizeComplexName(attrs);
        const unit = extractUnit(attrs);
        names.forEach((rawName, nameIndex) => {
            const parts = splitOwnerName(rawName);
            const ownerName = aggregateOwnerName(parts);
            const isBusiness = Boolean(cleanWhitespace(parts.company));
            const zipCode = cleanWhitespace(postcode);
            const zip5 = zipCode ? zipCode.split('-')[0]?.trim() ?? '' : '';
            let cityLine = city;
            if (cityLine && state) {
                cityLine = `${cityLine}, ${state}`;
            }
            else if (state) {
                cityLine = state;
            }
            const zipForLine = zipCode || zip5;
            if (cityLine && zipForLine) {
                cityLine = `${cityLine} ${zipForLine}`.trim();
            }
            else if (!cityLine && zipForLine) {
                cityLine = zipForLine;
            }
            const mailingLines = [addressLine1, addressLine2, cityLine].filter((line) => Boolean(cleanWhitespace(line)));
            const mailingAddress = mailingLines.join('\n');
            const detailUrl = detailIdentifier
                ? `https://gis.summitcountyco.gov/map/DetailData.aspx?Schno=${detailIdentifier}`
                : '';
            const rowId = `row-${index + 1}-${nameIndex + 1}`;
            const rowAttributes = {
                'Complex': sanitizeValue(complexName),
                'Unit': sanitizeValue(unit),
                'Owner Name': sanitizeValue(ownerName),
                'Owner Link': '',
                'Business Owner?': isBusiness ? 'Yes' : 'No',
                'Mailing Address': sanitizeValue(mailingAddress),
                'Address Line 1': sanitizeValue(addressLine1),
                'Address Line 2': sanitizeValue(addressLine2),
                'City (Required)': sanitizeValue(city),
                'State': sanitizeValue(state),
                'Zip5': sanitizeValue(zip5),
                'Zip9': sanitizeValue(zipCode),
                'Subdivision': sanitizeValue(subdivision),
                'Schedule Number': sanitizeValue(scheduleNumber),
                'Public Detail URL': detailUrl,
                'Physical Address': sanitizeValue(physicalAddress),
                'First name': sanitizeValue(parts.first),
                'Middle': sanitizeValue(parts.middle),
                'Last Name': sanitizeValue(parts.last),
                'Suffix': sanitizeValue(parts.suffix),
                'Title': sanitizeValue(parts.title),
                'Company (Required if last name is not provided)': sanitizeValue(parts.company),
                'Original Zip': sanitizeValue(postcode),
                'Comments': '',
                '__rowId': rowId,
                'PropertyScheduleText': sanitizeValue(scheduleNumber),
            };
            rows.push({
                attributes: rowAttributes,
                geometry: feature.geometry ?? null,
            });
        });
    });
    rows.sort((a, b) => {
        const complexA = ensureString(a.attributes?.['Complex'] ?? '').toLowerCase();
        const complexB = ensureString(b.attributes?.['Complex'] ?? '').toLowerCase();
        if (complexA < complexB) {
            return -1;
        }
        if (complexA > complexB) {
            return 1;
        }
        const unitA = ensureString(a.attributes?.['Unit'] ?? '');
        const unitB = ensureString(b.attributes?.['Unit'] ?? '');
        const [weightA, keyA] = unitSortKey(unitA);
        const [weightB, keyB] = unitSortKey(unitB);
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        if (keyA < keyB) {
            return -1;
        }
        if (keyA > keyB) {
            return 1;
        }
        return 0;
    });
    return rows;
}
