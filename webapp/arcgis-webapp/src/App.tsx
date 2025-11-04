import { useCallback, useEffect, useMemo, useState } from 'react';

import './App.css';
import FilterPanel from './components/FilterPanel';
import RegionMap from './components/RegionMap';
import ListingTable from './components/ListingTable';
import { buildSearchEnvelope, clearArcgisCaches, fetchListings } from './services/arcgisClient';
import { useCache } from './context/CacheContext';
import type {
  ArcgisFeature,
  ListingAttributes,
  ListingFilters,
  ListingRecord,
  RegionCircle,
} from './types';

const DEFAULT_FILTERS: ListingFilters = {
  searchTerm: '',
  mailingAddress: '',
  complex: '',
  owner: '',
  scheduleNumber: '',
  mailingCity: '',
  mailingState: '',
  mailingZip: '',
  subdivision: null,
  businessOwner: null,
};

const PAGE_SIZE = 25;

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
const REGION_STORAGE_KEY = 'arcgis-regions:v2';
const LISTINGS_CACHE_KEY = 'arcgis:listings:v2';
const DEFAULT_PIN_RADIUS_METERS = 750;
const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceBetweenCoordinates(
  originLat: number,
  originLng: number,
  targetLat: number,
  targetLng: number,
): number {
  const latDelta = toRadians(targetLat - originLat);
  const lngDelta = toRadians(targetLng - originLng);
  const originLatRad = toRadians(originLat);
  const targetLatRad = toRadians(targetLat);

  const haversine =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(originLatRad) * Math.cos(targetLatRad) * Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2);

  const c = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return EARTH_RADIUS_METERS * c;
}

function normaliseRegion(region: unknown): RegionCircle | null {
  if (!region || typeof region !== 'object') {
    return null;
  }

  const { lat, lng, radius } = region as {
    lat?: unknown;
    lng?: unknown;
    radius?: unknown;
  };

  if (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    typeof radius === 'number' &&
    Number.isFinite(radius) &&
    radius > 0
  ) {
    return { lat, lng, radius };
  }

  return null;
}

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

  const upper = clean.toUpperCase();
  if (BUSINESS_KEYWORDS.some((keyword) => upper.includes(keyword))) {
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

function toListingRecord(feature: ArcgisFeature<ListingAttributes>, index: number): ListingRecord {
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
    .map((parts, index) => {
      const aggregated = aggregateOwnerName(parts);
      if (aggregated) {
        return aggregated;
      }
      const fallbackSource = ownerSources[index];
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

  const subdivisionRaw = typeof attributes.SubdivisionName === 'string' ? attributes.SubdivisionName : '';
  const subdivision = subdivisionRaw ? titleCase(subdivisionRaw.trim()) : '';

  const detailIdRaw =
    (typeof attributes.HC_RegistrationsOriginalCleaned === 'string'
      ? attributes.HC_RegistrationsOriginalCleaned
      : null) || scheduleNumber;
  const publicDetailUrl = buildDetailUrl(detailIdRaw ?? '');

  const physicalAddressRaw =
    (typeof attributes.SitusAddress === 'string' && attributes.SitusAddress.trim()) ||
    (typeof attributes.BriefPropertyDescription === 'string' && attributes.BriefPropertyDescription.trim()) ||
    '';

  let latitude: number | null = null;
  let longitude: number | null = null;
  const geometry = feature.geometry as
    | {
        x?: unknown;
        y?: unknown;
        latitude?: unknown;
        longitude?: unknown;
        lat?: unknown;
        lng?: unknown;
      }
    | undefined;

  if (geometry && typeof geometry === 'object') {
    const candidates: Array<[unknown, unknown]> = [];
    if ('y' in geometry && 'x' in geometry) {
      candidates.push([geometry.y, geometry.x]);
    }
    if ('latitude' in geometry && 'longitude' in geometry) {
      candidates.push([geometry.latitude, geometry.longitude]);
    }
    if ('lat' in geometry && 'lng' in geometry) {
      candidates.push([geometry.lat, geometry.lng]);
    }

    for (const [candidateLat, candidateLng] of candidates) {
      if (
        typeof candidateLat === 'number' &&
        Number.isFinite(candidateLat) &&
        typeof candidateLng === 'number' &&
        Number.isFinite(candidateLng)
      ) {
        latitude = candidateLat;
        longitude = candidateLng;
        break;
      }
    }
  }

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
    latitude,
    longitude,
    raw: attributes,
  };
}

function applyFilters(
  listing: ListingRecord,
  filters: ListingFilters,
  pinRegion: RegionCircle | null,
): boolean {
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

  if (filters.mailingAddress.trim()) {
    const addressQuery = filters.mailingAddress.trim().toLowerCase();
    const mailingHaystack = listing.mailingAddress.toLowerCase();
    if (!mailingHaystack.includes(addressQuery)) {
      return false;
    }
  }

  if (filters.complex.trim()) {
    const complexQuery = filters.complex.trim().toLowerCase();
    if (!listing.complex.toLowerCase().includes(complexQuery)) {
      return false;
    }
  }

  if (filters.owner.trim()) {
    const ownerQuery = filters.owner.trim().toLowerCase();
    const ownerHaystack = `${listing.ownerName}; ${listing.ownerNames.join('; ')}`.toLowerCase();
    if (!ownerHaystack.includes(ownerQuery)) {
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
    if (
      !listing.mailingZip5.startsWith(zipQuery) &&
      !(zip9 && zip9.startsWith(zipQuery))
    ) {
      return false;
    }
  }

  if (filters.subdivision) {
    if (!listing.subdivision || listing.subdivision.toLowerCase() !== filters.subdivision.toLowerCase()) {
      return false;
    }
  }

  if (filters.businessOwner) {
    const expected = filters.businessOwner === 'yes';
    if (listing.isBusinessOwner !== expected) {
      return false;
    }
  }

  if (pinRegion) {
    const { lat, lng, radius } = pinRegion;
    if (radius > 0) {
      const { latitude, longitude } = listing;
      if (
        typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude)
      ) {
        return false;
      }

      const distance = distanceBetweenCoordinates(latitude, longitude, lat, lng);
      if (distance > radius) {
        return false;
      }
    }
  }

  return true;
}

function App(): JSX.Element {
  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [regions, setRegions] = useState<RegionCircle[]>([]);
  const [pinRegion, setPinRegion] = useState<RegionCircle | null>(null);
  const [pinDropRequestId, setPinDropRequestId] = useState(0);
  const [pinDropActive, setPinDropActive] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const { entries, get: getCache, set: setCache, clear: clearPersistentCache } = useCache();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem(REGION_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as
        | {
            drawnRegions?: unknown;
            pinRegion?: unknown;
          }
        | RegionCircle[];

      if (Array.isArray(parsed)) {
        const normalised = parsed
          .map((region) => normaliseRegion(region))
          .filter((region): region is RegionCircle => region !== null);
        if (normalised.length) {
          setRegions(normalised);
        }
        return;
      }

      if (parsed && typeof parsed === 'object') {
        const drawnRegionsRaw = Array.isArray(parsed.drawnRegions) ? parsed.drawnRegions : [];
        const normalisedDrawn = drawnRegionsRaw
          .map((region) => normaliseRegion(region))
          .filter((region): region is RegionCircle => region !== null);

        const storedPin = normaliseRegion(parsed.pinRegion);

        if (normalisedDrawn.length) {
          setRegions(normalisedDrawn);
        }

        if (storedPin) {
          setPinRegion(storedPin);
        }
      }
    } catch (storageError) {
      console.warn('Unable to restore saved regions from localStorage.', storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (regions.length === 0 && !pinRegion) {
        window.localStorage.removeItem(REGION_STORAGE_KEY);
        return;
      }

      const payload = {
        drawnRegions: regions.map((region) => ({
          lat: region.lat,
          lng: region.lng,
          radius: region.radius,
        })),
        pinRegion: pinRegion
          ? { lat: pinRegion.lat, lng: pinRegion.lng, radius: pinRegion.radius }
          : null,
      };

      window.localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify(payload));
    } catch (storageError) {
      console.warn('Unable to persist regions to localStorage.', storageError);
    }
  }, [pinRegion, regions]);

  const handleRegionsChange = useCallback((nextRegions: RegionCircle[]) => {
    setRegions((current) => {
      if (
        current.length === nextRegions.length &&
        current.every((region, index) => {
          const next = nextRegions[index];
          return (
            next &&
            region.lat === next.lat &&
            region.lng === next.lng &&
            region.radius === next.radius
          );
        })
      ) {
        return current;
      }

      return nextRegions.map((region) => ({ ...region }));
    });
  }, []);

  const handlePinRegionChange = useCallback((nextRegion: RegionCircle | null) => {
    setPinRegion((current) => {
      if (!nextRegion) {
        return current ? null : current;
      }

      if (
        current &&
        current.lat === nextRegion.lat &&
        current.lng === nextRegion.lng &&
        current.radius === nextRegion.radius
      ) {
        return current;
      }

      return { ...nextRegion };
    });
  }, []);

  const handlePinRadiusChange = useCallback((radius: number) => {
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_PIN_RADIUS_METERS;
    setPinRegion((current) => {
      if (!current) {
        return current;
      }
      if (current.radius === safeRadius) {
        return current;
      }
      return { ...current, radius: safeRadius };
    });
  }, []);

  const handleRequestPinDrop = useCallback(() => {
    setPinDropActive(true);
    setPinDropRequestId((current) => current + 1);
  }, []);

  const handleCancelPinDrop = useCallback(() => {
    setPinDropActive(false);
  }, []);

  const handlePinDropComplete = useCallback(() => {
    setPinDropActive(false);
  }, []);

  const handleClearPinRegion = useCallback(() => {
    setPinRegion(null);
  }, []);

  const searchRegions = useMemo(() => {
    const drawn = regions.map((region) => ({
      lat: region.lat,
      lng: region.lng,
      radius: region.radius,
    }));
    if (pinRegion) {
      drawn.push({ lat: pinRegion.lat, lng: pinRegion.lng, radius: pinRegion.radius });
    }
    return drawn;
  }, [pinRegion, regions]);

  const regionSignature = useMemo(() => {
    return JSON.stringify({
      drawn: regions.map((region) => ({
        lat: region.lat,
        lng: region.lng,
        radius: region.radius,
      })),
      pin: pinRegion ? { lat: pinRegion.lat, lng: pinRegion.lng, radius: pinRegion.radius } : null,
    });
  }, [pinRegion, regions]);
  const listingCacheEntry = useMemo(() => {
    return entries.find((entry) => entry.key === LISTINGS_CACHE_KEY && entry.dependencies?.[0] === regionSignature);
  }, [entries, regionSignature]);
  const cachedAt = useMemo(() => {
    if (!listingCacheEntry) {
      return null;
    }
    return new Date(listingCacheEntry.storedAt);
  }, [listingCacheEntry]);

  useEffect(() => {
    console.groupCollapsed('ArcGIS listing fetch request');
    console.debug('Region signature', regionSignature);
    console.debug('Drawn regions', regions);
    console.debug('Pin region', pinRegion);

    let groupClosed = false;
    const endGroup = () => {
      if (!groupClosed) {
        console.groupEnd();
        groupClosed = true;
      }
    };

    const dependencies = [regionSignature] as const;
    const cached = getCache<ListingRecord[]>(LISTINGS_CACHE_KEY, { dependencies });
    if (cached) {
      console.info(`Using ${cached.length.toLocaleString()} cached ArcGIS listings for region signature ${regionSignature}.`);
      setListings(cached);
      setError(null);
      setLoading(false);
      endGroup();
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const regionGeometries = searchRegions.map((region) =>
      buildSearchEnvelope({
        latitude: region.lat,
        longitude: region.lng,
        radiusMeters: region.radius,
      }),
    );

    console.info('Requesting listings from ArcGIS.', {
      dependencies,
      regionCount: searchRegions.length,
      requestCount: regionGeometries.length || 1,
    });

    const fetchPromises =
      regionGeometries.length > 0
        ? regionGeometries.map((geometry) =>
            fetchListings({
              filters: { returnGeometry: true },
              geometry,
              signal: controller.signal,
            }).then((featureSet) => featureSet.features ?? []),
          )
        : [
            fetchListings({
              filters: { returnGeometry: true },
              signal: controller.signal,
            }).then((featureSet) => featureSet.features ?? []),
          ];

    Promise.all(fetchPromises)
      .then((pages) => {
        const combinedFeatures = pages.flat();
        console.info(
          `Received ${combinedFeatures.length.toLocaleString()} listings from ArcGIS across ${fetchPromises.length.toLocaleString()} request(s).`,
        );
        const seenIds = new Set<string>();
        const mapped: ListingRecord[] = [];
        combinedFeatures.forEach((feature, index) => {
          const record = toListingRecord(feature, index);
          if (seenIds.has(record.id)) {
            return;
          }
          seenIds.add(record.id);
          mapped.push(record);
        });
        console.debug('Mapped listing sample', mapped.slice(0, 3));
        setListings(mapped);
        setCache(LISTINGS_CACHE_KEY, mapped, {
          dependencies,
          ttl: 1000 * 60 * 15,
        });
      })
      .catch((fetchError) => {
        const errorName =
          fetchError && typeof fetchError === 'object' && 'name' in fetchError
            ? String((fetchError as { name?: unknown }).name)
            : '';
        const isAbortError = controller.signal.aborted || errorName === 'AbortError';

        if (isAbortError) {
          console.warn('ArcGIS listings request aborted.');
          endGroup();
          return;
        }

        const message =
          fetchError instanceof Error ? fetchError.message : 'Unable to load listings from ArcGIS.';
        console.error('ArcGIS listings request failed.', fetchError);
        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
        endGroup();
      });

    return () => {
      console.info('Aborting in-flight ArcGIS listing request.');
      controller.abort();
      endGroup();
    };
  }, [getCache, pinRegion, refreshCounter, regionSignature, searchRegions, setCache]);

  useEffect(() => {
    console.debug('Filters updated', filters);
  }, [filters]);

  useEffect(() => {
    console.debug('Regions updated', regions);
  }, [regions]);

  useEffect(() => {
    console.debug('Pin region updated', pinRegion);
  }, [pinRegion]);

  useEffect(() => {
    if (listings.length) {
      console.info(`Applying filters to ${listings.length.toLocaleString()} listings.`);
    }
  }, [listings.length]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pinRegion, regions]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => applyFilters(listing, filters, pinRegion));
  }, [filters, listings, pinRegion]);

  useEffect(() => {
    if (!listings.length) {
      return;
    }
    console.info(
      `Filters narrowed ${listings.length.toLocaleString()} listings down to ${filteredListings.length.toLocaleString()} results.`,
    );
  }, [filteredListings.length, listings.length]);

  const subdivisionOptions = useMemo(() => {
    const values = new Set<string>();
    listings.forEach((listing) => {
      if (listing.subdivision) {
        values.add(listing.subdivision);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const stateOptions = useMemo(() => {
    const values = new Set<string>();
    listings.forEach((listing) => {
      if (listing.mailingState) {
        values.add(listing.mailingState);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const handleRefresh = useCallback(() => {
    console.info('Manual refresh requested. Clearing caches and forcing ArcGIS refetch.');
    clearPersistentCache(LISTINGS_CACHE_KEY);
    clearArcgisCaches();
    setRefreshCounter((current) => current + 1);
  }, [clearPersistentCache]);

  const cacheSummary = useMemo(() => {
    if (!cachedAt) {
      return 'No cached results';
    }
    return `Cached ${cachedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }, [cachedAt]);

  const filteredCount = filteredListings.length;

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Refreshing listings from ArcGIS…';
    }
    if (error) {
      return `ArcGIS request failed: ${error}`;
    }
    if (listings.length === 0) {
      return 'No ArcGIS listings have been loaded yet.';
    }

    const baseMessage =
      filteredCount === listings.length
        ? `Loaded ${listings.length.toLocaleString()} listings.`
        : `Showing ${filteredCount.toLocaleString()} of ${listings.length.toLocaleString()} listings after filters.`;

    if (cachedAt) {
      return `${baseMessage} Cached ${cachedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`;
    }
    return baseMessage;
  }, [cachedAt, error, filteredCount, loading, listings.length]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS Web App</h1>
          <p>Explore Summit County short-term rental listings with instant filtering and pagination.</p>
        </div>
        <div className="app__actions">
          <button
            type="button"
            className="app__refresh"
            onClick={handleRefresh}
            disabled={loading}
            title="Clear cached ArcGIS data and request fresh results."
          >
            Refresh data
          </button>
          <span className="app__cache" title={cacheSummary}>
            {cacheSummary}
          </span>
        </div>
      </header>

      <section className="app__status" role="status" aria-live="polite">
        {statusMessage}
      </section>

      <main className="app__content">
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          subdivisionOptions={subdivisionOptions}
          stateOptions={stateOptions}
          disabled={loading}
          pinRegion={pinRegion}
          onRequestPinDrop={handleRequestPinDrop}
          onCancelPinDrop={handleCancelPinDrop}
          onPinRadiusChange={handlePinRadiusChange}
          onClearPinRegion={handleClearPinRegion}
          pinDropActive={pinDropActive}
          defaultPinRadius={DEFAULT_PIN_RADIUS_METERS}
        />
        <div className="app__main">
          <RegionMap
            regions={regions}
            onRegionsChange={handleRegionsChange}
            pinRegion={pinRegion}
            onPinRegionChange={handlePinRegionChange}
            pinDropActive={pinDropActive}
            pinDropRequestId={pinDropRequestId}
            onPinDropComplete={handlePinDropComplete}
            defaultPinRadius={DEFAULT_PIN_RADIUS_METERS}
          />
          <ListingTable
            listings={filteredListings}
            pageSize={PAGE_SIZE}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            isLoading={loading}
            error={error}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
