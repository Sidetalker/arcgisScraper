import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  addListingToWatchlist,
  createWatchlist as createWatchlistInStorage,
  fetchWatchlists,
  deleteWatchlist as deleteWatchlistInStorage,
  removeListingFromWatchlist,
  renameWatchlist as renameWatchlistInStorage,
  type WatchlistRecord,
} from '@/services/watchlists';
import { isSupabaseConfigured } from '@/services/supabaseClient';

interface WatchlistsContextValue {
  watchlists: WatchlistRecord[];
  loading: boolean;
  error: string | null;
  supabaseConfigured: boolean;
  refresh: () => Promise<void>;
  createWatchlist: (name: string) => Promise<WatchlistRecord>;
  renameWatchlist: (watchlistId: string, name: string) => Promise<WatchlistRecord>;
  deleteWatchlist: (watchlistId: string) => Promise<void>;
  addListing: (watchlistId: string, listingId: string) => Promise<void>;
  removeListing: (watchlistId: string, listingId: string) => Promise<void>;
}

const WatchlistsContext = createContext<WatchlistsContextValue | undefined>(undefined);

export function WatchlistsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [watchlists, setWatchlists] = useState<WatchlistRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(isSupabaseConfigured);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setWatchlists([]);
      setSupabaseConfigured(false);
      setError('Connect Supabase to manage shared watchlists.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const records = await fetchWatchlists();
      setWatchlists(records);
      setSupabaseConfigured(true);
    } catch (fetchError) {
      console.error('Failed to load watchlists from Supabase.', fetchError);
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : 'Unable to load watchlists from Supabase.';
      setError(message);
      if (
        fetchError instanceof Error &&
        fetchError.message.includes('Supabase client is not initialised')
      ) {
        setSupabaseConfigured(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createWatchlist = useCallback(async (name: string) => {
    if (!supabaseConfigured) {
      throw new Error('Connect Supabase to manage shared watchlists.');
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Watchlist name cannot be empty.');
    }

    const record = await createWatchlistInStorage(trimmedName);
    setWatchlists((current) => {
      const next = [...current, record];
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    return record;
  }, [supabaseConfigured]);

  const renameWatchlist = useCallback(async (watchlistId: string, name: string) => {
    if (!supabaseConfigured) {
      throw new Error('Connect Supabase to manage shared watchlists.');
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Watchlist name cannot be empty.');
    }

    const record = await renameWatchlistInStorage(watchlistId, trimmedName);
    setWatchlists((current) => {
      const next = current.map((watchlist) =>
        watchlist.id === record.id ? { ...watchlist, name: record.name, updatedAt: record.updatedAt } : watchlist,
      );
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    return record;
  }, [supabaseConfigured]);

  const addListing = useCallback(async (watchlistId: string, listingId: string) => {
    if (!supabaseConfigured) {
      throw new Error('Connect Supabase to manage shared watchlists.');
    }

    await addListingToWatchlist(watchlistId, listingId);
    setWatchlists((current) =>
      current.map((watchlist) => {
        if (watchlist.id !== watchlistId) {
          return watchlist;
        }
        if (watchlist.listingIds.includes(listingId)) {
          return watchlist;
        }
        const nextIds = [...watchlist.listingIds, listingId];
        nextIds.sort((a, b) => a.localeCompare(b));
        return {
          ...watchlist,
          listingIds: nextIds,
          updatedAt: new Date(),
        };
      }),
    );
  }, [supabaseConfigured]);

  const removeListing = useCallback(async (watchlistId: string, listingId: string) => {
    if (!supabaseConfigured) {
      throw new Error('Connect Supabase to manage shared watchlists.');
    }

    await removeListingFromWatchlist(watchlistId, listingId);
    setWatchlists((current) =>
      current.map((watchlist) => {
        if (watchlist.id !== watchlistId) {
          return watchlist;
        }
        if (!watchlist.listingIds.includes(listingId)) {
          return watchlist;
        }
        const nextIds = watchlist.listingIds.filter((id) => id !== listingId);
        return {
          ...watchlist,
          listingIds: nextIds,
          updatedAt: new Date(),
        };
      }),
    );
  }, [supabaseConfigured]);

  const deleteWatchlist = useCallback(async (watchlistId: string) => {
    if (!supabaseConfigured) {
      throw new Error('Connect Supabase to manage shared watchlists.');
    }

    await deleteWatchlistInStorage(watchlistId);
    setWatchlists((current) => current.filter((watchlist) => watchlist.id !== watchlistId));
  }, [supabaseConfigured]);

  const value = useMemo(
    () => ({
      watchlists,
      loading,
      error,
      supabaseConfigured,
      refresh,
      createWatchlist,
      renameWatchlist,
      deleteWatchlist,
      addListing,
      removeListing,
    }),
    [
      watchlists,
      loading,
      error,
      supabaseConfigured,
      refresh,
      createWatchlist,
      renameWatchlist,
      deleteWatchlist,
      addListing,
      removeListing,
    ],
  );

  return <WatchlistsContext.Provider value={value}>{children}</WatchlistsContext.Provider>;
}

export function useWatchlists(): WatchlistsContextValue {
  const context = useContext(WatchlistsContext);
  if (!context) {
    throw new Error('useWatchlists must be used within a WatchlistsProvider.');
  }
  return context;
}
