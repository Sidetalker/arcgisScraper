import './FavoritesPage.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import FilterPanel from '@/components/FilterPanel';
import ListingTable from '@/components/ListingTable';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE } from '@/constants/listings';
import {
  createDefaultTableState,
  type ListingTableState,
} from '@/constants/listingTable';
import { useListings } from '@/context/ListingsContext';
import { applyFilters } from '@/services/listingTransformer';
import type { ListingFilters } from '@/types';

function FavoritesPage(): JSX.Element {
  const { listings, loading, error, supabaseConfigured, updateListingFavorite } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [tableState, setTableState] = useState<ListingTableState>(() => createDefaultTableState());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';

  const favoritedListings = useMemo(
    () => listings.filter((listing) => listing.isFavorited),
    [listings],
  );

  const filteredListings = useMemo(
    () => favoritedListings.filter((listing) => applyFilters(listing, filters)),
    [favoritedListings, filters],
  );

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

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Loading favorites from Supabase…';
    }
    if (error) {
      return `Supabase request failed: ${error}`;
    }
    if (favoritedListings.length === 0) {
      return 'No listings have been marked as favorites yet.';
    }
    if (filteredListings.length === 0) {
      return 'No favorites match the current filters.';
    }
    return `Showing ${filteredListings.length.toLocaleString()} favorited listing${
      filteredListings.length === 1 ? '' : 's'
    }.`;
  }, [loading, error, favoritedListings.length, filteredListings.length]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  return (
    <div className="favorites-page">
      <section className="favorites-page__filters">
        <FilterPanel
          filters={filters}
          onChange={handleFiltersChange}
          disabled={loading}
          onReset={handleResetFilters}
        />
      </section>
      <section className="favorites-page__table">
        <ListingTable
          listings={filteredListings}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          isLoading={loading}
          error={error}
          columnOrder={tableState.columnOrder}
          hiddenColumns={tableState.hiddenColumns}
          columnFilters={tableState.columnFilters}
          onColumnOrderChange={handleColumnOrderChange}
          onHiddenColumnsChange={handleHiddenColumnsChange}
          onColumnFiltersChange={handleColumnFiltersChange}
          onFavoriteChange={handleFavoriteChange}
          canToggleFavorites={supabaseConfigured}
          favoriteDisabledReason={favoritesDisabledMessage}
        />
      </section>
    </div>
  );
}

export default FavoritesPage;
