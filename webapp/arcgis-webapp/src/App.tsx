import { useCallback, useEffect, useMemo, useState } from 'react';

import './App.css';
import FilterPanel from './components/FilterPanel';
import RegionMap from './components/RegionMap';
import ListingTable from './components/ListingTable';
import { clearArcgisCaches, fetchListings } from './services/arcgisClient';
import { circlesToPolygonGeometry } from './services/regionGeometry';
import { useCache } from './context/CacheContext';
import { formatOwnerRecords } from './services/ownerFormatter';
import type { ListingFilters, OwnerRecord, RegionCircle } from './types';

const DEFAULT_FILTERS: ListingFilters = {
  ownerName: '',
  complex: '',
  city: '',
  state: '',
  zip: '',
  subdivision: '',
  scheduleNumber: '',
  unit: '',
  businessType: 'all',
};

const PAGE_SIZE = 25;
const REGION_STORAGE_KEY = 'arcgis-regions:v1';
const LISTINGS_CACHE_KEY = 'arcgis:listings';

function applyFilters(listing: OwnerRecord, filters: ListingFilters): boolean {
  const matchText = (value: string, query: string) => {
    if (!query.trim()) {
      return true;
    }
    return value.toLowerCase().includes(query.trim().toLowerCase());
  };

  if (!matchText(listing.ownerName, filters.ownerName)) {
    return false;
  }

  if (!matchText(listing.complex, filters.complex)) {
    return false;
  }

  if (!matchText(listing.city, filters.city)) {
    return false;
  }

  if (filters.state.trim()) {
    if (listing.state.toLowerCase() !== filters.state.trim().toLowerCase()) {
      return false;
    }
  }

  if (filters.zip.trim()) {
    const normalisedZip = filters.zip.trim().toLowerCase();
    const candidate = `${listing.zip5} ${listing.zip9}`.toLowerCase();
    if (!candidate.includes(normalisedZip)) {
      return false;
    }
  }

  if (!matchText(listing.subdivision, filters.subdivision)) {
    return false;
  }

  if (!matchText(listing.scheduleNumber, filters.scheduleNumber)) {
    return false;
  }

  if (!matchText(listing.unit, filters.unit)) {
    return false;
  }

  if (filters.businessType === 'business' && !listing.businessOwner) {
    return false;
  }

  if (filters.businessType === 'individual' && listing.businessOwner) {
    return false;
  }

  return true;
}

function App(): JSX.Element {
  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  const [listings, setListings] = useState<OwnerRecord[]>([]);
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
    const cached = getCache<OwnerRecord[]>(LISTINGS_CACHE_KEY, { dependencies });
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
        const mapped = formatOwnerRecords(features);
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

  const stateOptions = useMemo(() => {
    const states = new Set<string>();
    listings.forEach((listing) => {
      if (listing.state) {
        states.add(listing.state);
      }
    });
    return Array.from(states).sort((a, b) => a.localeCompare(b));
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
      return 'Refreshing owner records from ArcGIS…';
    }
    if (error) {
      return `ArcGIS request failed: ${error}`;
    }
    if (listings.length === 0) {
      return 'No ArcGIS owner records have been loaded yet.';
    }

    const baseMessage =
      filteredCount === listings.length
        ? `Loaded ${listings.length.toLocaleString()} owner records.`
        : `Showing ${filteredCount.toLocaleString()} of ${listings.length.toLocaleString()} owner records after filters.`;

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
          <p>Explore Summit County short-term rental owner records with instant filtering and pagination.</p>
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
        <FilterPanel filters={filters} onChange={setFilters} stateOptions={stateOptions} disabled={loading} />
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
