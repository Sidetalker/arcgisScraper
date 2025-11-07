import './BlacklistedPage.css';

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
import type { ListingCustomizationOverrides } from '@/services/listingStorage';
import type { ListingFilters } from '@/types';

function BlacklistedPage(): JSX.Element {
  const {
    listings,
    loading,
    error,
    supabaseConfigured,
    updateListingFavorite,
    updateListingDetails,
    revertListingToOriginal,
  } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [tableState, setTableState] = useState<ListingTableState>(() => createDefaultTableState());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';
  const editDisabledMessage = 'Connect Supabase to customize listings.';

  const blacklistedListings = useMemo(
    () => listings.filter((listing) => listing.isOwnerBlacklisted),
    [listings],
  );

  const filteredListings = useMemo(
    () => blacklistedListings.filter((listing) => applyFilters(listing, filters)),
    [blacklistedListings, filters],
  );

  const handleFiltersChange = useCallback((nextFilters: ListingFilters) => {
    setFilters(nextFilters);
    setCurrentPage(1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setCurrentPage(1);
  }, []);

  const handleColumnOrderChange = useCallback((order: ListingTableState['columnOrder']) => {
    setTableState((previous) => ({
      ...previous,
      columnOrder: [...order],
    }));
  }, []);

  const handleHiddenColumnsChange = useCallback((hidden: ListingTableState['hiddenColumns']) => {
    setTableState((previous) => ({
      ...previous,
      hiddenColumns: [...hidden],
    }));
  }, []);

  const handleColumnFiltersChange = useCallback((nextFilters: ListingTableState['columnFilters']) => {
    setTableState((previous) => ({
      ...previous,
      columnFilters: { ...nextFilters },
    }));
  }, []);

  const handleSortChange = useCallback((nextSort: ListingTableState['sort']) => {
    setTableState((previous) => ({
      ...previous,
      sort: nextSort ? { ...nextSort } : null,
    }));
  }, []);

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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update favorite status.';
        setStatusMessage(message);
        throw err instanceof Error ? err : new Error(message);
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
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save listing changes.';
        setStatusMessage(message);
        throw err instanceof Error ? err : new Error(message);
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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to restore listing data.';
        setStatusMessage(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [editDisabledMessage, setStatusMessage, supabaseConfigured, revertListingToOriginal],
  );

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Loading blacklisted listings…';
    }
    if (error) {
      return `Supabase request failed: ${error}`;
    }
    if (blacklistedListings.length === 0) {
      return 'No owners have been added to the blacklist yet.';
    }
    if (filteredListings.length === 0) {
      return 'No blacklisted listings match the current filters.';
    }
    return `Showing ${filteredListings.length.toLocaleString()} listing${
      filteredListings.length === 1 ? '' : 's'
    } owned by blacklisted owners.`;
  }, [loading, error, blacklistedListings.length, filteredListings.length]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  return (
    <div className="blacklisted-page">
      <section className="blacklisted-page__filters app__section app__section--full">
        <FilterPanel
          filters={filters}
          onChange={handleFiltersChange}
          disabled={loading}
          onReset={handleResetFilters}
        />
      </section>
      <section className="blacklisted-page__table">
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
          canEditListings={supabaseConfigured}
          editDisabledReason={editDisabledMessage}
          commentLinkPath="/blacklisted"
        />
      </section>
    </div>
  );
}

export default BlacklistedPage;
