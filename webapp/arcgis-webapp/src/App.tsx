import { useCallback, useEffect, useMemo, useState } from 'react';

import './App.css';
import FilterPanel from './components/FilterPanel';
import RegionMap from './components/RegionMap';
import ListingTable from './components/ListingTable';
import { clearArcgisCaches, fetchListings } from './services/arcgisClient';
import { circlesToPolygonGeometry } from './services/regionGeometry';
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
  minPrice: null,
  maxPrice: null,
  minBeds: null,
  minBaths: null,
  status: null,
};

const PAGE_SIZE = 25;

const ADDRESS_KEYS = ['SITEADDR', 'SITE_ADDRESS', 'SITEADDRESS', 'Address', 'ADDRESS', 'SITEADD'];
const CITY_KEYS = ['CITY', 'City', 'MUNICIPALITY', 'Town'];
const PRICE_KEYS = ['NightlyRate', 'NIGHTLYRATE', 'AVERAGENIGHTLYRATE', 'AverageNightlyRate', 'PRICE', 'Price'];
const BED_KEYS = ['Bedrooms', 'BEDROOMS', 'BEDS', 'Beds'];
const BATH_KEYS = ['Bathrooms', 'BATHROOMS', 'Baths', 'BATHS'];
const STATUS_KEYS = ['STATUS', 'Status', 'LICENSESTATUS', 'LicenseStatus'];
const OCCUPANCY_KEYS = ['Occupancy', 'OCCUPANCY', 'MaxOccupancy', 'MAXOCCUPANCY'];
const ID_KEYS = ['OBJECTID', 'OBJECTID_1', 'GlobalID', 'GLOBALID', 'License', 'LICENSE'];
const REGION_STORAGE_KEY = 'arcgis-regions:v1';
const LISTINGS_CACHE_KEY = 'arcgis:listings';

function pickString(attributes: ListingAttributes, keys: string[]): string | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(attributes: ListingAttributes, keys: string[]): number | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function toListingRecord(feature: ArcgisFeature<ListingAttributes>, index: number): ListingRecord {
  const attributes = feature.attributes ?? {};
  const idString = pickString(attributes, ID_KEYS);
  const idNumber = pickNumber(attributes, ID_KEYS);
  const id =
    idString ??
    (typeof idNumber === 'number' ? idNumber.toString() : `listing-${attributes.OBJECTID ?? index}`);

  return {
    id,
    address: pickString(attributes, ADDRESS_KEYS) ?? '',
    city: pickString(attributes, CITY_KEYS) ?? '',
    nightlyRate: pickNumber(attributes, PRICE_KEYS),
    bedrooms: pickNumber(attributes, BED_KEYS),
    bathrooms: pickNumber(attributes, BATH_KEYS),
    status: pickString(attributes, STATUS_KEYS),
    occupancy: pickNumber(attributes, OCCUPANCY_KEYS),
    raw: attributes,
  };
}

function applyFilters(listing: ListingRecord, filters: ListingFilters): boolean {
  const search = filters.searchTerm.trim().toLowerCase();
  if (search) {
    const haystack = `${listing.address} ${listing.city}`.toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filters.minPrice !== null) {
    if (listing.nightlyRate === null || listing.nightlyRate < filters.minPrice) {
      return false;
    }
  }

  if (filters.maxPrice !== null) {
    if (listing.nightlyRate === null || listing.nightlyRate > filters.maxPrice) {
      return false;
    }
  }

  if (filters.minBeds !== null) {
    if (listing.bedrooms === null || listing.bedrooms < filters.minBeds) {
      return false;
    }
  }

  if (filters.minBaths !== null) {
    if (listing.bathrooms === null || listing.bathrooms < filters.minBaths) {
      return false;
    }
  }

  if (filters.status) {
    const listingStatus = listing.status ? listing.status.toLowerCase() : '';
    if (listingStatus !== filters.status.toLowerCase()) {
      return false;
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

      const parsed = JSON.parse(stored) as RegionCircle[];
      if (!Array.isArray(parsed)) {
        return;
      }

      const normalised = parsed
        .filter((region) =>
          region &&
          typeof region.lat === 'number' &&
          typeof region.lng === 'number' &&
          typeof region.radius === 'number' &&
          Number.isFinite(region.lat) &&
          Number.isFinite(region.lng) &&
          Number.isFinite(region.radius) &&
          region.radius > 0,
        )
        .map((region) => ({
          lat: region.lat,
          lng: region.lng,
          radius: region.radius,
        }));

      if (normalised.length) {
        setRegions(normalised);
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
      if (regions.length === 0) {
        window.localStorage.removeItem(REGION_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify(regions));
    } catch (storageError) {
      console.warn('Unable to persist regions to localStorage.', storageError);
    }
  }, [regions]);

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

  const queryGeometry = useMemo(() => circlesToPolygonGeometry(regions), [regions]);
  const geometrySignature = useMemo(() => JSON.stringify(queryGeometry ?? null), [queryGeometry]);
  const listingCacheEntry = useMemo(() => {
    return entries.find((entry) => entry.key === LISTINGS_CACHE_KEY && entry.dependencies?.[0] === geometrySignature);
  }, [entries, geometrySignature]);
  const cachedAt = useMemo(() => {
    if (!listingCacheEntry) {
      return null;
    }
    return new Date(listingCacheEntry.storedAt);
  }, [listingCacheEntry]);

  useEffect(() => {
    const dependencies = [geometrySignature] as const;
    const cached = getCache<ListingRecord[]>(LISTINGS_CACHE_KEY, { dependencies });
    if (cached) {
      setListings(cached);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchListings({
      filters: { returnGeometry: false },
      geometry: queryGeometry,
      signal: controller.signal,
    })
      .then((featureSet) => {
        const features = featureSet.features ?? [];
        const mapped = features.map((feature, index) => toListingRecord(feature, index));
        setListings(mapped);
        setCache(LISTINGS_CACHE_KEY, mapped, {
          dependencies,
          ttl: 1000 * 60 * 15,
        });
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) {
          return;
        }
        const message =
          fetchError instanceof Error ? fetchError.message : 'Unable to load listings from ArcGIS.';
        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [geometrySignature, getCache, queryGeometry, refreshCounter, setCache]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, regions]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => applyFilters(listing, filters));
  }, [listings, filters]);

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    listings.forEach((listing) => {
      if (listing.status) {
        statuses.add(listing.status);
      }
    });
    return Array.from(statuses);
  }, [listings]);

  const handleRefresh = useCallback(() => {
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
          statusOptions={statusOptions}
          disabled={loading}
        />
        <div className="app__main">
          <RegionMap regions={regions} onRegionsChange={handleRegionsChange} />
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
