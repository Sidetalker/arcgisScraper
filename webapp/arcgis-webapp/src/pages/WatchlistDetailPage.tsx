import './WatchlistDetailPage.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';

import FilterPanel from '@/components/FilterPanel';
import ListingTable from '@/components/ListingTable';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE } from '@/constants/listings';
import {
  createDefaultTableState,
  type ListingTableState,
} from '@/constants/listingTable';
import { useListings } from '@/context/ListingsContext';
import { useWatchlists } from '@/context/WatchlistsContext';
import { applyFilters } from '@/services/listingTransformer';
import type { ListingCustomizationOverrides } from '@/services/listingStorage';
import { saveSelectedWatchlistId } from '@/services/watchlistSelectionStorage';
import type { ListingFilters } from '@/types';

function WatchlistDetailPage(): JSX.Element {
  const { watchlistId } = useParams<{ watchlistId: string }>();
  const navigate = useNavigate();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();
  const {
    listings,
    loading: listingsLoading,
    error: listingsError,
    supabaseConfigured,
    updateListingFavorite,
    updateListingDetails,
    revertListingToOriginal,
  } = useListings();
  const {
    watchlists,
    loading: watchlistsLoading,
    error: watchlistsError,
    supabaseConfigured: watchlistsSupabaseConfigured,
    createWatchlist,
    addListing,
    removeListing,
  } = useWatchlists();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [tableState, setTableState] = useState<ListingTableState>(() => createDefaultTableState());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const watchlist = useMemo(
    () => watchlists.find((entry) => entry.id === (watchlistId ?? '')) ?? null,
    [watchlistId, watchlists],
  );

  const watchlistMembership = useMemo(() => {
    return new Set<string>(watchlist?.listingIds ?? []);
  }, [watchlist]);

  const watchlistListings = useMemo(
    () => listings.filter((listing) => watchlistMembership.has(listing.id)),
    [listings, watchlistMembership],
  );

  const filteredListings = useMemo(
    () => watchlistListings.filter((listing) => applyFilters(listing, filters)),
    [watchlistListings, filters],
  );

  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';
  const editDisabledMessage = 'Connect Supabase to customize listings.';
  const watchlistsDisabledMessage = 'Connect Supabase to manage shared watchlists.';

  const loading = listingsLoading || watchlistsLoading;
  const errorMessage = listingsError ?? watchlistsError ?? null;

  const handleFiltersChange = useCallback((nextFilters: ListingFilters) => {
    setFilters(nextFilters);
    setCurrentPage(1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setCurrentPage(1);
  }, []);

  const handleColumnOrderChange = useCallback(
    (order: ListingTableState['columnOrder']) => {
      setTableState((previous) => ({
        ...previous,
        columnOrder: [...order],
      }));
    },
    [],
  );

  const handleHiddenColumnsChange = useCallback(
    (hidden: ListingTableState['hiddenColumns']) => {
      setTableState((previous) => ({
        ...previous,
        hiddenColumns: [...hidden],
      }));
    },
    [],
  );

  const handleColumnFiltersChange = useCallback(
    (nextFilters: ListingTableState['columnFilters']) => {
      setTableState((previous) => ({
        ...previous,
        columnFilters: { ...nextFilters },
      }));
    },
    [],
  );

  const handleSortChange = useCallback(
    (nextSort: ListingTableState['sort']) => {
      setTableState((previous) => ({
        ...previous,
        sort: nextSort ? { ...nextSort } : null,
      }));
    },
    [],
  );

  const handleFavoriteChange = useCallback(
    async (listingId: string, isFavorited: boolean) => {
      if (!supabaseConfigured) {
        setStatusMessage(favoritesDisabledMessage);
        throw new Error(favoritesDisabledMessage);
      }

      try {
        await updateListingFavorite(listingId, isFavorited);
        setStatusMessage(
          isFavorited ? 'Listing added to favorites.' : 'Listing removed from favorites.',
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update favorite status.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [favoritesDisabledMessage, setStatusMessage, supabaseConfigured, updateListingFavorite],
  );

  const handleListingEdit = useCallback(
    async (listingId: string, overrides: ListingCustomizationOverrides) => {
      if (!supabaseConfigured) {
        setStatusMessage(editDisabledMessage);
        throw new Error(editDisabledMessage);
      }

      try {
        await updateListingDetails(listingId, overrides);
        setStatusMessage('Listing changes saved.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save listing changes.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [
      editDisabledMessage,
      setStatusMessage,
      supabaseConfigured,
      updateListingDetails,
    ],
  );

  const handleListingRevert = useCallback(
    async (listingId: string) => {
      if (!supabaseConfigured) {
        setStatusMessage(editDisabledMessage);
        throw new Error(editDisabledMessage);
      }

      try {
        await revertListingToOriginal(listingId);
        setStatusMessage('Listing restored to original data.');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to restore listing data.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [editDisabledMessage, setStatusMessage, supabaseConfigured, revertListingToOriginal],
  );

  const handleSelectWatchlist = useCallback(
    (nextId: string | null) => {
      if (!nextId) {
        saveSelectedWatchlistId(null);
        navigate('/');
        return;
      }
      if (nextId !== watchlistId) {
        saveSelectedWatchlistId(nextId);
        navigate(`/watchlists/${nextId}`);
      }
    },
    [navigate, watchlistId],
  );

  const handleCreateWatchlist = useCallback(async () => {
    if (!watchlistsSupabaseConfigured) {
      setStatusMessage(watchlistsDisabledMessage);
      throw new Error(watchlistsDisabledMessage);
    }

    if (typeof window === 'undefined') {
      return;
    }

    const name = window.prompt('Name your new watchlist', 'New watchlist');
    if (!name) {
      return;
    }

    setStatusMessage('Creating watchlist…');
    try {
      const record = await createWatchlist(name);
      navigate(`/watchlists/${record.id}`);
      saveSelectedWatchlistId(record.id);
      setStatusMessage(`Watchlist “${record.name}” created. Start selecting listings to include.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create watchlist.';
      setStatusMessage(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [createWatchlist, navigate, setStatusMessage, watchlistsDisabledMessage, watchlistsSupabaseConfigured]);

  const handleWatchlistToggle = useCallback(
    async (listingId: string, isSelected: boolean) => {
      if (!watchlist) {
        return;
      }

      if (!watchlistsSupabaseConfigured) {
        setStatusMessage(watchlistsDisabledMessage);
        throw new Error(watchlistsDisabledMessage);
      }

      try {
        if (isSelected) {
          await addListing(watchlist.id, listingId);
          setStatusMessage(`Listing added to ${watchlist.name}.`);
        } else {
          await removeListing(watchlist.id, listingId);
          setStatusMessage(`Listing removed from ${watchlist.name}.`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update watchlist membership.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [
      addListing,
      removeListing,
      setStatusMessage,
      watchlist,
      watchlistsDisabledMessage,
      watchlistsSupabaseConfigured,
    ],
  );

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Loading watchlist listings…';
    }
    if (errorMessage) {
      return `Supabase request failed: ${errorMessage}`;
    }
    if (!watchlist) {
      return 'Watchlist not found.';
    }
    if (watchlistMembership.size === 0) {
      return 'No properties have been added to this watchlist yet.';
    }
    if (filteredListings.length === 0) {
      return 'No watchlist listings match the current filters.';
    }
    return `Showing ${filteredListings.length.toLocaleString()} listing${
      filteredListings.length === 1 ? '' : 's'
    } in ${watchlist.name}.`;
  }, [
    errorMessage,
    filteredListings.length,
    loading,
    watchlist,
    watchlistMembership.size,
  ]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  const selectedWatchlist = watchlist ?? null;
  const selectedCount = selectedWatchlist ? selectedWatchlist.listingIds.length : 0;

  useEffect(() => {
    if (selectedWatchlist) {
      saveSelectedWatchlistId(selectedWatchlist.id);
      return;
    }

    if (!watchlistId) {
      saveSelectedWatchlistId(null);
    }
  }, [selectedWatchlist, watchlistId]);

  return (
    <div className="watchlist-page">
      <header className="watchlist-page__header">
        <h2 className="watchlist-page__title">
          {selectedWatchlist ? selectedWatchlist.name : 'Watchlist overview'}
        </h2>
        <p className="watchlist-page__meta">
          {selectedWatchlist
            ? `${selectedCount.toLocaleString()} propert${selectedCount === 1 ? 'y' : 'ies'} tracked`
            : 'Select a watchlist to manage its properties.'}
        </p>
      </header>

      <section className="watchlist-page__filters app__section app__section--full">
        <FilterPanel
          filters={filters}
          onChange={handleFiltersChange}
          disabled={loading}
          onReset={handleResetFilters}
          watchlistControls={{
            options: watchlists.map((entry) => ({
              id: entry.id,
              name: entry.name,
              listingCount: entry.listingIds.length,
            })),
            selectedWatchlistId: watchlistId ?? null,
            onSelectWatchlist: handleSelectWatchlist,
            onCreateWatchlist: handleCreateWatchlist,
            isBusy: watchlistsLoading,
            canManage: watchlistsSupabaseConfigured,
            createDisabledReason: watchlistsSupabaseConfigured
              ? undefined
              : watchlistsDisabledMessage,
            errorMessage: watchlistsError,
            activeSummary: selectedWatchlist
              ? { name: selectedWatchlist.name, listingCount: selectedCount }
              : null,
          }}
        />
      </section>

      <section className="watchlist-page__table">
        <ListingTable
          listings={filteredListings}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          isLoading={loading}
          error={errorMessage}
          columnOrder={tableState.columnOrder}
          hiddenColumns={tableState.hiddenColumns}
          columnFilters={tableState.columnFilters}
          sort={tableState.sort}
          onColumnOrderChange={handleColumnOrderChange}
          onHiddenColumnsChange={handleHiddenColumnsChange}
          onColumnFiltersChange={handleColumnFiltersChange}
          onSortChange={handleSortChange}
          onFavoriteChange={handleFavoriteChange}
          onListingEdit={handleListingEdit}
          onListingRevert={handleListingRevert}
          canToggleFavorites={supabaseConfigured}
          favoriteDisabledReason={favoritesDisabledMessage}
          selectionMode={selectedWatchlist ? 'watchlist' : 'favorites'}
          selectedListingIds={selectedWatchlist ? watchlistMembership : undefined}
          onSelectionChange={selectedWatchlist ? handleWatchlistToggle : undefined}
          canChangeSelection={selectedWatchlist ? watchlistsSupabaseConfigured : undefined}
          selectionDisabledReason={selectedWatchlist ? watchlistsDisabledMessage : undefined}
          selectionLabel={selectedWatchlist ? `${selectedWatchlist.name} membership` : undefined}
          canEditListings={supabaseConfigured}
          editDisabledReason={editDisabledMessage}
        />
      </section>
    </div>
  );
}

export default WatchlistDetailPage;
