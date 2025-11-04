import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useCache } from '@/context/CacheContext';
import { buildSearchEnvelope, clearArcgisCaches, fetchListings } from '@/services/arcgisClient';
import { toListingRecord } from '@/services/listingTransformer';
import type { ListingRecord, RegionCircle } from '@/types';

const REGION_STORAGE_KEY = 'arcgis-regions:v1';
export const LISTINGS_CACHE_KEY = 'arcgis:listings';

export interface ListingsContextValue {
  listings: ListingRecord[];
  loading: boolean;
  error: string | null;
  regions: RegionCircle[];
  cachedAt: Date | null;
  onRegionsChange: (nextRegions: RegionCircle[]) => void;
  refresh: () => void;
}

const ListingsContext = createContext<ListingsContextValue | undefined>(undefined);

export function ListingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        .filter(
          (region) =>
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

  const regionSignature = useMemo(() => {
    return JSON.stringify(
      regions.map((region) => ({
        lat: region.lat,
        lng: region.lng,
        radius: region.radius,
      })),
    );
  }, [regions]);

  const listingCacheEntry = useMemo(() => {
    return entries.find(
      (entry) => entry.key === LISTINGS_CACHE_KEY && entry.dependencies?.[0] === regionSignature,
    );
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
    console.debug('Regions', regions);

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
      console.info(
        `Using ${cached.length.toLocaleString()} cached ArcGIS listings for region signature ${regionSignature}.`,
      );
      setListings(cached);
      setError(null);
      setLoading(false);
      endGroup();
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const regionGeometries = regions.map((region) =>
      buildSearchEnvelope({
        latitude: region.lat,
        longitude: region.lng,
        radiusMeters: region.radius,
      }),
    );

    console.info('Requesting listings from ArcGIS.', {
      dependencies,
      regionCount: regions.length,
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
          fetchError instanceof Error
            ? fetchError.message
            : 'Unable to load listings from ArcGIS.';
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
  }, [getCache, refreshCounter, regionSignature, regions, setCache]);

  useEffect(() => {
    if (!listings.length) {
      return;
    }
    console.info(`Fetched ${listings.length.toLocaleString()} listings from ArcGIS.`);
  }, [listings.length]);

  const refresh = useCallback(() => {
    console.info('Manual refresh requested. Clearing caches and forcing ArcGIS refetch.');
    clearPersistentCache(LISTINGS_CACHE_KEY);
    clearArcgisCaches();
    setRefreshCounter((current) => current + 1);
  }, [clearPersistentCache]);

  const value = useMemo(
    () => ({
      listings,
      loading,
      error,
      regions,
      cachedAt,
      onRegionsChange: handleRegionsChange,
      refresh,
    }),
    [cachedAt, error, handleRegionsChange, listings, loading, refresh, regions],
  );

  return <ListingsContext.Provider value={value}>{children}</ListingsContext.Provider>;
}

export function useListings(): ListingsContextValue {
  const context = useContext(ListingsContext);
  if (!context) {
    throw new Error('useListings must be used within a ListingsProvider');
  }
  return context;
}
