import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { fetchListings, fetchStrLicenseRoster } from '@/services/arcgisClient';
import { clearListingsCache, loadListingsFromCache, saveListingsToCache } from '@/services/listingLocalCache';
import {
  applyListingOverrides,
  addOwnerToBlacklist as addOwnerToBlacklistEntry,
  fetchStoredListings,
  removeOwnerFromBlacklist as removeOwnerFromBlacklistEntry,
  replaceAllListings,
  removeListingCustomization,
  recordMatchesOwnerBlacklist,
  type ListingCustomizationOverrides,
  type OwnerBlacklistEntry,
  updateListingFavorite as updateListingFavoriteFlag,
  upsertListingCustomization,
} from '@/services/listingStorage';
import { toListingRecord } from '@/services/listingTransformer';
import { enrichListingsWithLicenseData } from '@/services/strLicenseUtils';
import {
  cloneRegionShape,
  normaliseRegionList,
  regionsAreEqual,
} from '@/services/regionShapes';
import { isSupabaseConfigured } from '@/services/supabaseClient';
import type { ListingRecord, RegionShape } from '@/types';

const REGION_STORAGE_KEY = 'arcgis-regions:v1';

function normalizeOwnerNameKey(value: string): string {
  return value.trim().toLowerCase();
}

export interface ListingsContextValue {
  listings: ListingRecord[];
  loading: boolean;
  error: string | null;
  regions: RegionShape[];
  cachedAt: Date | null;
  localCachedAt: Date | null;
  isLocalCacheStale: boolean;
  source: 'local' | 'supabase' | 'syncing' | 'unknown';
  supabaseConfigured: boolean;
  blacklistedOwners: OwnerBlacklistEntry[];
  onRegionsChange: (nextRegions: RegionShape[]) => void;
  refresh: () => void;
  syncing: boolean;
  syncFromArcgis: () => Promise<void>;
  clearCacheAndReload: () => Promise<void>;
  updateListingFavorite: (listingId: string, isFavorited: boolean) => Promise<void>;
  updateListingDetails: (
    listingId: string,
    overrides: ListingCustomizationOverrides,
  ) => Promise<void>;
  revertListingToOriginal: (listingId: string) => Promise<void>;
  addOwnerToBlacklist: (ownerName: string) => Promise<void>;
  removeOwnerFromBlacklist: (ownerName: string) => Promise<void>;
}

const ListingsContext = createContext<ListingsContextValue | undefined>(undefined);

export function ListingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionShape[]>([]);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [localCachedAt, setLocalCachedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [source, setSource] = useState<'local' | 'supabase' | 'syncing' | 'unknown'>('unknown');
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(isSupabaseConfigured);
  const [blacklistedOwners, setBlacklistedOwners] = useState<OwnerBlacklistEntry[]>([]);
  const blacklistedOwnersRef = useRef<OwnerBlacklistEntry[]>([]);

  useEffect(() => {
    blacklistedOwnersRef.current = blacklistedOwners;
  }, [blacklistedOwners]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem(REGION_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      const normalised = normaliseRegionList(parsed);
      if (normalised.length) {
        setRegions(normalised.map((region) => cloneRegionShape(region)));
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

  const handleRegionsChange = useCallback((nextRegions: RegionShape[]) => {
    setRegions((current) => {
      if (regionsAreEqual(current, nextRegions)) {
        return current;
      }

      return nextRegions.map((region) => cloneRegionShape(region));
    });
  }, []);

  const persistLocalCache = useCallback(
    async (
      records: ListingRecord[],
      supabaseUpdatedAt: Date | null,
      owners: OwnerBlacklistEntry[] | null = null,
    ) => {
      const ownersToPersist = owners ?? blacklistedOwnersRef.current;
      try {
        const savedAt = await saveListingsToCache(records, supabaseUpdatedAt, ownersToPersist);
        setLocalCachedAt(savedAt);
        setSource('local');
      } catch (storageError) {
        console.warn('Unable to persist listings cache to IndexedDB.', storageError);
      }
    },
    [],
  );

  const applyBlacklistToRecords = useCallback(
    (records: ListingRecord[], owners: OwnerBlacklistEntry[] | null = null) => {
      const activeOwners = owners ?? blacklistedOwnersRef.current;
      if (activeOwners.length === 0) {
        return records.map((record) =>
          record.isOwnerBlacklisted ? { ...record, isOwnerBlacklisted: false } : record,
        );
      }

      const ownerSet = new Set(
        activeOwners.map((entry) => entry.ownerNameNormalized).filter((value) => value.length > 0),
      );

      return records.map((record) => {
        const isBlacklisted = recordMatchesOwnerBlacklist(record, ownerSet);
        if (record.isOwnerBlacklisted === isBlacklisted) {
          return record;
        }
        return { ...record, isOwnerBlacklisted: isBlacklisted };
      });
    },
    [],
  );

  const deriveBlacklistedOwners = useCallback((records: ListingRecord[]): OwnerBlacklistEntry[] => {
    const entries = new Map<string, OwnerBlacklistEntry>();
    records.forEach((record) => {
      if (!record.isOwnerBlacklisted) {
        return;
      }
      const normalized = normalizeOwnerNameKey(record.ownerName);
      if (!normalized || entries.has(normalized)) {
        return;
      }
      entries.set(normalized, {
        ownerName: record.ownerName,
        ownerNameNormalized: normalized,
        createdAt: null,
        updatedAt: null,
      });
    });

    return Array.from(entries.values()).sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  }, []);

  const applyListingSnapshot = useCallback(
    (
      records: ListingRecord[],
      supabaseUpdatedAt: Date | null,
      savedAt?: Date | null,
      owners?: OwnerBlacklistEntry[] | null,
    ): { records: ListingRecord[]; owners: OwnerBlacklistEntry[] } => {
      const sortedOwners = (owners ?? deriveBlacklistedOwners(records))
        .slice()
        .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
      const recordsWithBlacklist = applyBlacklistToRecords(records, sortedOwners);

      setListings(recordsWithBlacklist);
      blacklistedOwnersRef.current = sortedOwners;
      setBlacklistedOwners(sortedOwners);
      if (supabaseUpdatedAt) {
        setCachedAt(supabaseUpdatedAt);
      }
      if (savedAt) {
        setLocalCachedAt(savedAt);
      }
      if (!savedAt) {
        setSource('supabase');
      }
      return { records: recordsWithBlacklist, owners: sortedOwners };
    },
    [applyBlacklistToRecords, deriveBlacklistedOwners],
  );

  const hydrateFromLocalCache = useCallback(async () => {
    try {
      const cached = await loadListingsFromCache();
      if (!cached || cached.records.length === 0) {
        return false;
      }

      applyListingSnapshot(cached.records, cached.supabaseUpdatedAt, cached.savedAt, cached.owners);
      return true;
    } catch (error) {
      console.warn('Unable to restore listings from IndexedDB.', error);
      return false;
    }
  }, [applyListingSnapshot]);

  const loadListingsFromSupabase = useCallback(async () => {
    setLoading(true);
    setSource('supabase');
    setError(null);
    try {
      const { records, latestUpdatedAt, blacklistedOwners: owners } = await fetchStoredListings();
      setSupabaseConfigured(true);
      const snapshot = applyListingSnapshot(records, latestUpdatedAt ?? null, null, owners);
      await persistLocalCache(snapshot.records, latestUpdatedAt ?? null, snapshot.owners);
    } catch (loadError) {
      console.error('Failed to fetch listings from Supabase.', loadError);
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load listings from Supabase.';
      setError(message);
      if (
        loadError instanceof Error &&
        loadError.message.includes('Supabase client is not initialised')
      ) {
        setSupabaseConfigured(false);
      }
    } finally {
      setLoading(false);
    }
  }, [applyListingSnapshot, persistLocalCache]);

  useEffect(() => {
    void (async () => {
      const hadLocal = await hydrateFromLocalCache();
      if (!hadLocal) {
        await loadListingsFromSupabase();
      }
    })();
  }, [hydrateFromLocalCache, loadListingsFromSupabase]);

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
      applyListingSnapshot([], null, null, []);
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

      const licenseFeatureSet = await fetchStrLicenseRoster();
      const enrichedRecords = enrichListingsWithLicenseData(records, licenseFeatureSet);

      await replaceAllListings(enrichedRecords);
      const syncTimestamp = new Date();
      const snapshot = applyListingSnapshot(
        enrichedRecords,
        syncTimestamp,
        syncTimestamp,
        blacklistedOwnersRef.current,
      );
      await persistLocalCache(snapshot.records, syncTimestamp, snapshot.owners);
      console.info('Supabase listings were synchronised successfully.', {
        listingCount: enrichedRecords.length,
        licenseRosterCount: licenseFeatureSet.features?.length ?? 0,
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

  const updateFavorite = useCallback(
    async (listingId: string, isFavorited: boolean) => {
      setListings((current) =>
        applyBlacklistToRecords(
          current.map((listing) =>
            listing.id === listingId ? { ...listing, isFavorited } : listing,
          ),
        ),
      );

      try {
        const { record, updatedAt } = await updateListingFavoriteFlag(listingId, isFavorited);
        setListings((current) => {
          const nextListings = applyBlacklistToRecords(
            current.map((listing) =>
              listing.id === listingId
                ? { ...listing, isFavorited: record.isFavorited }
                : listing,
            ),
          );
          void persistLocalCache(nextListings, updatedAt ?? cachedAt);
          return nextListings;
        });
        setCachedAt((previous) => {
          if (!updatedAt) {
            return previous;
          }
          if (!previous || updatedAt > previous) {
            return updatedAt;
          }
          return previous;
        });
        setSupabaseConfigured(true);
      } catch (error) {
        console.error('Failed to update favorite state in Supabase.', error);
        setListings((current) =>
          applyBlacklistToRecords(
            current.map((listing) =>
              listing.id === listingId ? { ...listing, isFavorited: !isFavorited } : listing,
            ),
          ),
        );
        if (
          error instanceof Error &&
          error.message.includes('Supabase client is not initialised')
        ) {
          setSupabaseConfigured(false);
        }
        throw error instanceof Error ? error : new Error('Failed to update favorite state.');
      }
    },
    [applyBlacklistToRecords, persistLocalCache, cachedAt],
  );

  const updateDetails = useCallback(
    async (listingId: string, overrides: ListingCustomizationOverrides) => {
      let previousListing: ListingRecord | null = null;
      setListings((current) => {
        previousListing = current.find((listing) => listing.id === listingId) ?? null;
        if (!previousListing) {
          return current;
        }
        const updated = current.map((listing) =>
          listing.id === listingId ? applyListingOverrides(listing, overrides) : listing,
        );
        return applyBlacklistToRecords(updated);
      });

      if (!previousListing) {
        throw new Error('Listing not found.');
      }

      try {
        const { record, updatedAt } = await upsertListingCustomization(listingId, overrides);
        setListings((current) => {
          const nextListings = applyBlacklistToRecords(
            current.map((listing) => (listing.id === listingId ? record : listing)),
          );
          void persistLocalCache(nextListings, updatedAt ?? cachedAt);
          return nextListings;
        });
        setCachedAt((previous) => {
          if (!updatedAt) {
            return previous;
          }
          if (!previous || updatedAt > previous) {
            return updatedAt;
          }
          return previous;
        });
        setSupabaseConfigured(true);
      } catch (error) {
        console.error('Failed to save listing customizations in Supabase.', error);
        setListings((current) =>
          applyBlacklistToRecords(
            current.map((listing) =>
              listing.id === listingId && previousListing ? previousListing : listing,
            ),
          ),
        );
        if (
          error instanceof Error &&
          error.message.includes('Supabase client is not initialised')
        ) {
          setSupabaseConfigured(false);
        }
        throw error instanceof Error ? error : new Error('Failed to save listing changes.');
      }
    },
    [applyBlacklistToRecords, persistLocalCache, cachedAt],
  );

  const revertListing = useCallback(
    async (listingId: string) => {
      let previousListing: ListingRecord | null = null;
      setListings((current) => {
        previousListing = current.find((listing) => listing.id === listingId) ?? null;
        if (!previousListing) {
          return current;
        }
        const updated = current.map((listing) =>
          listing.id === listingId ? { ...listing, hasCustomizations: false } : listing,
        );
        return applyBlacklistToRecords(updated);
      });

      if (!previousListing) {
        throw new Error('Listing not found.');
      }

      try {
        const { record, updatedAt } = await removeListingCustomization(listingId);
        setListings((current) => {
          const nextListings = applyBlacklistToRecords(
            current.map((listing) => (listing.id === listingId ? record : listing)),
          );
          void persistLocalCache(nextListings, updatedAt ?? cachedAt);
          return nextListings;
        });
        setCachedAt((previous) => {
          if (!updatedAt) {
            return previous;
          }
          if (!previous || updatedAt > previous) {
            return updatedAt;
          }
          return previous;
        });
        setSupabaseConfigured(true);
      } catch (error) {
        console.error('Failed to revert listing customizations in Supabase.', error);
        setListings((current) =>
          applyBlacklistToRecords(
            current.map((listing) =>
              listing.id === listingId && previousListing ? previousListing : listing,
            ),
          ),
        );
        if (
          error instanceof Error &&
          error.message.includes('Supabase client is not initialised')
        ) {
          setSupabaseConfigured(false);
        }
        throw error instanceof Error ? error : new Error('Failed to revert listing changes.');
      }
    },
    [applyBlacklistToRecords, persistLocalCache, cachedAt],
  );

  const addBlacklistEntry = useCallback(
    async (ownerName: string) => {
      const trimmed = ownerName.trim();
      const normalized = normalizeOwnerNameKey(trimmed);
      if (!normalized) {
        throw new Error('Owner name must not be empty.');
      }

      try {
        const { entry, updatedAt } = await addOwnerToBlacklistEntry(trimmed);
        let nextOwners: OwnerBlacklistEntry[] = [];
        setBlacklistedOwners((current) => {
          const filtered = current.filter(
            (item) => item.ownerNameNormalized !== entry.ownerNameNormalized,
          );
          nextOwners = [...filtered, entry].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
          blacklistedOwnersRef.current = nextOwners;
          return nextOwners;
        });

        const changeTimestamp = entry.updatedAt ?? updatedAt ?? new Date();
        setListings((current) => {
          const nextListings = applyBlacklistToRecords(current, nextOwners);
          void persistLocalCache(nextListings, changeTimestamp, nextOwners);
          return nextListings;
        });

        setCachedAt((previous) => {
          if (!changeTimestamp) {
            return previous;
          }
          if (!previous || changeTimestamp > previous) {
            return changeTimestamp;
          }
          return previous;
        });
        setSupabaseConfigured(true);
      } catch (error) {
        console.error('Failed to add owner to blacklist in Supabase.', error);
        if (
          error instanceof Error &&
          error.message.includes('Supabase client is not initialised')
        ) {
          setSupabaseConfigured(false);
        }
        throw error instanceof Error ? error : new Error('Failed to update owner blacklist.');
      }
    },
    [applyBlacklistToRecords, cachedAt, persistLocalCache],
  );

  const removeBlacklistEntry = useCallback(
    async (ownerName: string) => {
      const normalized = normalizeOwnerNameKey(ownerName);
      if (!normalized) {
        throw new Error('Owner name must not be empty.');
      }

      try {
        const { ownerNameNormalized, updatedAt } = await removeOwnerFromBlacklistEntry(ownerName);
        let nextOwners: OwnerBlacklistEntry[] = [];
        setBlacklistedOwners((current) => {
          nextOwners = current
            .filter((item) => item.ownerNameNormalized !== ownerNameNormalized)
            .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
          blacklistedOwnersRef.current = nextOwners;
          return nextOwners;
        });

        const changeTimestamp = updatedAt ?? new Date();
        setListings((current) => {
          const nextListings = applyBlacklistToRecords(current, nextOwners);
          void persistLocalCache(nextListings, changeTimestamp, nextOwners);
          return nextListings;
        });

        setCachedAt((previous) => {
          if (!changeTimestamp) {
            return previous;
          }
          if (!previous || changeTimestamp > previous) {
            return changeTimestamp;
          }
          return previous;
        });
        setSupabaseConfigured(true);
      } catch (error) {
        console.error('Failed to remove owner from blacklist in Supabase.', error);
        if (
          error instanceof Error &&
          error.message.includes('Supabase client is not initialised')
        ) {
          setSupabaseConfigured(false);
        }
        throw error instanceof Error ? error : new Error('Failed to update owner blacklist.');
      }
    },
    [applyBlacklistToRecords, cachedAt, persistLocalCache],
  );

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
      supabaseConfigured,
      blacklistedOwners,
      onRegionsChange: handleRegionsChange,
      refresh,
      syncing,
      syncFromArcgis,
      updateListingFavorite: updateFavorite,
      updateListingDetails: updateDetails,
      revertListingToOriginal: revertListing,
      clearCacheAndReload,
      addOwnerToBlacklist: addBlacklistEntry,
      removeOwnerFromBlacklist: removeBlacklistEntry,
    }),
    [
      cachedAt,
      error,
      handleRegionsChange,
      supabaseConfigured,
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
      updateFavorite,
      updateDetails,
      revertListing,
      blacklistedOwners,
      addBlacklistEntry,
      removeBlacklistEntry,
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
