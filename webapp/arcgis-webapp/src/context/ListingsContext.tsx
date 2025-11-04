import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { clearListingsCache, loadListingsFromCache, saveListingsToCache } from '@/services/listingLocalCache';
import { fetchStoredListings, replaceAllListings } from '@/services/listingStorage';
import {
  fetchRecentListingSyncEvents,
  insertListingSyncEvent,
  type ListingSyncEvent,
} from '@/services/listingSyncEvents';
import { syncListingsFromArcgis } from '@/shared/listingSync';
import type { ListingRecord, RegionCircle } from '@/types';

const REGION_STORAGE_KEY = 'arcgis-regions:v1';

export interface ListingsContextValue {
  listings: ListingRecord[];
  loading: boolean;
  error: string | null;
  regions: RegionCircle[];
  cachedAt: Date | null;
  localCachedAt: Date | null;
  isLocalCacheStale: boolean;
  source: 'local' | 'supabase' | 'syncing' | 'unknown';
  onRegionsChange: (nextRegions: RegionCircle[]) => void;
  refresh: () => void;
  syncing: boolean;
  syncFromArcgis: () => Promise<void>;
  clearCacheAndReload: () => Promise<void>;
  syncEvents: ListingSyncEvent[];
}

const ListingsContext = createContext<ListingsContextValue | undefined>(undefined);

export function ListingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionCircle[]>([]);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [localCachedAt, setLocalCachedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [source, setSource] = useState<'local' | 'supabase' | 'syncing' | 'unknown'>('unknown');
  const [syncEvents, setSyncEvents] = useState<ListingSyncEvent[]>([]);

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

  const persistLocalCache = useCallback(
    async (records: ListingRecord[], supabaseUpdatedAt: Date | null) => {
      try {
        const savedAt = await saveListingsToCache(records, supabaseUpdatedAt);
        setLocalCachedAt(savedAt);
        setSource('local');
      } catch (storageError) {
        console.warn('Unable to persist listings cache to IndexedDB.', storageError);
      }
    },
    [],
  );

  const applyListingSnapshot = useCallback(
    (records: ListingRecord[], supabaseUpdatedAt: Date | null, savedAt?: Date | null) => {
      setListings(records);
      if (supabaseUpdatedAt) {
        setCachedAt(supabaseUpdatedAt);
      }
      if (savedAt) {
        setLocalCachedAt(savedAt);
      }
      if (!savedAt) {
        setSource('supabase');
      }
    },
    [],
  );

  const hydrateFromLocalCache = useCallback(async () => {
    try {
      const cached = await loadListingsFromCache();
      if (!cached || cached.records.length === 0) {
        return false;
      }

      applyListingSnapshot(cached.records, cached.supabaseUpdatedAt, cached.savedAt);
      return true;
    } catch (error) {
      console.warn('Unable to restore listings from IndexedDB.', error);
      return false;
    }
  }, [applyListingSnapshot]);

  const loadSyncEvents = useCallback(async () => {
    try {
      const events = await fetchRecentListingSyncEvents({ limit: 10 });
      setSyncEvents(events);
    } catch (eventError) {
      console.warn('Unable to load sync event history.', eventError);
    }
  }, []);

  const loadListingsFromSupabase = useCallback(async () => {
    setLoading(true);
    setSource('supabase');
    setError(null);
    try {
      const { records, latestUpdatedAt } = await fetchStoredListings();
      applyListingSnapshot(records, latestUpdatedAt ?? null, null);
      await persistLocalCache(records, latestUpdatedAt ?? null);
      await loadSyncEvents();
    } catch (loadError) {
      console.error('Failed to fetch listings from Supabase.', loadError);
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load listings from Supabase.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [applyListingSnapshot, loadSyncEvents, persistLocalCache]);

  useEffect(() => {
    void loadSyncEvents();
    void (async () => {
      const hadLocal = await hydrateFromLocalCache();
      if (!hadLocal) {
        await loadListingsFromSupabase();
      }
    })();
  }, [hydrateFromLocalCache, loadListingsFromSupabase, loadSyncEvents]);

  const refresh = useCallback(() => {
    console.info('Refreshing listings from Supabase.');
    loadListingsFromSupabase();
  }, [loadListingsFromSupabase]);

  const clearCacheAndReload = useCallback(async () => {
    console.info('Clearing local listings cache and reloading from Supabase.');
    setLoading(true);
    setError(null);
    try {
      await clearListingsCache();
      applyListingSnapshot([], null, null);
      setCachedAt(null);
      setLocalCachedAt(null);
      setSource('unknown');
      await loadListingsFromSupabase();
      console.info('Local cache cleared and reloaded successfully.');
    } catch (clearError) {
      console.error('Failed to clear local cache.', clearError);
      const message =
        clearError instanceof Error
          ? clearError.message
          : 'Unable to clear local cache.';
      setError(message);
      throw clearError instanceof Error ? clearError : new Error(message);
    } finally {
      setLoading(false);
    }
  }, [applyListingSnapshot, loadListingsFromSupabase]);

  const syncFromArcgis = useCallback(async () => {
    console.info('Syncing listings from ArcGIS into Supabase.');
    setSyncing(true);
    setSource('syncing');
    setError(null);
    try {
      const result = await syncListingsFromArcgis('manual', {
        loadSnapshot: () => fetchStoredListings(),
        replaceAll: (records: ListingRecord[]) => replaceAllListings(records),
        recordEvent: insertListingSyncEvent,
      });

      const syncTimestamp = result.event.completedAt ?? result.summary.completedAt;
      applyListingSnapshot(result.records, syncTimestamp, syncTimestamp);
      await persistLocalCache(result.records, syncTimestamp);
      setSyncEvents((current) => {
        const withoutDuplicate = current.filter((event) => event.id !== result.event.id);
        return [result.event, ...withoutDuplicate].slice(0, 10);
      });
      console.info('Supabase listings were synchronised successfully.', {
        listingCount: result.records.length,
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
  }, [applyListingSnapshot, persistLocalCache]);

  const isLocalCacheStale = useMemo(() => {
    if (!localCachedAt || !cachedAt) {
      return false;
    }
    return localCachedAt < cachedAt;
  }, [localCachedAt, cachedAt]);

  const value = useMemo(
    () => ({
      listings,
      loading,
      error,
      regions,
      cachedAt,
      localCachedAt,
      isLocalCacheStale,
      source,
      onRegionsChange: handleRegionsChange,
      refresh,
      syncing,
      syncFromArcgis,
      clearCacheAndReload,
      syncEvents,
    }),
    [
      cachedAt,
      error,
      handleRegionsChange,
      listings,
      loading,
      localCachedAt,
      isLocalCacheStale,
      source,
      refresh,
      clearCacheAndReload,
      regions,
      syncing,
      syncFromArcgis,
      syncEvents,
    ],
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
