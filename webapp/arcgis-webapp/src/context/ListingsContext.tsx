import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { fetchListings } from '@/services/arcgisClient';
import { fetchStoredListings, replaceAllListings } from '@/services/listingStorage';
import { toListingRecord } from '@/services/listingTransformer';
import type { ListingRecord, RegionCircle } from '@/types';

const REGION_STORAGE_KEY = 'arcgis-regions:v1';

export interface ListingsContextValue {
  listings: ListingRecord[];
  loading: boolean;
  error: string | null;
  regions: RegionCircle[];
  cachedAt: Date | null;
  onRegionsChange: (nextRegions: RegionCircle[]) => void;
  refresh: () => void;
  syncing: boolean;
  syncFromArcgis: () => Promise<void>;
}

const ListingsContext = createContext<ListingsContextValue | undefined>(undefined);

export function ListingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionCircle[]>([]);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  const loadListingsFromSupabase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { records, latestUpdatedAt } = await fetchStoredListings();
      setListings(records);
      setCachedAt(latestUpdatedAt);
    } catch (loadError) {
      console.error('Failed to fetch listings from Supabase.', loadError);
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load listings from Supabase.';
      setError(message);
      setListings([]);
      setCachedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadListingsFromSupabase();
  }, [loadListingsFromSupabase]);

  const refresh = useCallback(() => {
    console.info('Refreshing listings from Supabase.');
    loadListingsFromSupabase();
  }, [loadListingsFromSupabase]);

  const syncFromArcgis = useCallback(async () => {
    console.info('Syncing listings from ArcGIS into Supabase.');
    setSyncing(true);
    setError(null);
    try {
      const featureSet = await fetchListings({
        filters: { returnGeometry: true },
        useCache: false,
      });
      const features = featureSet.features ?? [];
      const seen = new Set<string>();
      const records: ListingRecord[] = [];
      features.forEach((feature, index) => {
        const record = toListingRecord(feature, index);
        if (seen.has(record.id)) {
          return;
        }
        seen.add(record.id);
        records.push(record);
      });

      await replaceAllListings(records);
      setListings(records);
      setCachedAt(new Date());
      console.info('Supabase listings were synchronised successfully.', {
        listingCount: records.length,
      });
    } catch (syncError) {
      console.error('Failed to sync listings from ArcGIS into Supabase.', syncError);
      const message =
        syncError instanceof Error
          ? syncError.message
          : 'Unable to sync listings from ArcGIS.';
      setError(message);
      throw syncError;
    } finally {
      setSyncing(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      listings,
      loading,
      error,
      regions,
      cachedAt,
      onRegionsChange: handleRegionsChange,
      refresh,
      syncing,
      syncFromArcgis,
    }),
    [cachedAt, error, handleRegionsChange, listings, loading, refresh, regions, syncing, syncFromArcgis],
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
