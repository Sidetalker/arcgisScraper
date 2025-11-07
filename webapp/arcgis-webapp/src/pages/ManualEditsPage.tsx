import './ManualEditsPage.css';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import ListingTable from '@/components/ListingTable';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_PAGE_SIZE } from '@/constants/listings';
import {
  createDefaultTableState,
  type ListingTableState,
} from '@/constants/listingTable';
import { useListings } from '@/context/ListingsContext';
import type { ListingCustomizationOverrides } from '@/services/listingStorage';
import { countManualEditColumns } from '@/utils/listingCustomizations';

function ManualEditsPage(): JSX.Element {
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

  const [tableState, setTableState] = useState<ListingTableState>(() => createDefaultTableState());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [minimumColumns, setMinimumColumns] = useState(1);

  const thresholdInputId = useId();

  const editDisabledMessage = 'Connect Supabase to customize listings.';
  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';

  const listingsWithManualEdits = useMemo(() => {
    return listings
      .map((listing) => ({
        listing,
        editedColumns: countManualEditColumns(listing),
      }))
      .filter((entry) => entry.editedColumns > 0);
  }, [listings]);

  const filteredListings = useMemo(() => {
    const threshold = Math.max(1, Math.floor(minimumColumns));
    return listingsWithManualEdits
      .filter((entry) => entry.editedColumns >= threshold)
      .map((entry) => entry.listing);
  }, [listingsWithManualEdits, minimumColumns]);

  useEffect(() => {
    setCurrentPage(1);
  }, [minimumColumns, listingsWithManualEdits.length]);

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
      } catch (updateError) {
        const message =
          updateError instanceof Error ? updateError.message : 'Failed to update favorite status.';
        setStatusMessage(message);
        throw updateError instanceof Error ? updateError : new Error(message);
      }
    },
    [
      favoritesDisabledMessage,
      setStatusMessage,
      supabaseConfigured,
      updateListingFavorite,
    ],
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
      } catch (updateError) {
        const message =
          updateError instanceof Error ? updateError.message : 'Failed to save listing changes.';
        setStatusMessage(message);
        throw updateError instanceof Error ? updateError : new Error(message);
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
      } catch (updateError) {
        const message =
          updateError instanceof Error ? updateError.message : 'Failed to restore listing data.';
        setStatusMessage(message);
        throw updateError instanceof Error ? updateError : new Error(message);
      }
    },
    [editDisabledMessage, setStatusMessage, supabaseConfigured, revertListingToOriginal],
  );

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Loading listings with manual edits…';
    }
    if (error) {
      return `Supabase request failed: ${error}`;
    }
    if (listingsWithManualEdits.length === 0) {
      return 'No listings have manual edits yet.';
    }
    if (filteredListings.length === 0) {
      return `No listings meet the minimum of ${minimumColumns} edited column${
        minimumColumns === 1 ? '' : 's'
      }.`;
    }
    return `Showing ${filteredListings.length.toLocaleString()} of ${listingsWithManualEdits.length.toLocaleString()} listings with manual edits (minimum ${minimumColumns} column${
      minimumColumns === 1 ? '' : 's'
    }).`;
  }, [
    error,
    filteredListings.length,
    listingsWithManualEdits.length,
    loading,
    minimumColumns,
  ]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  return (
    <div className="manual-edits-page">
      <section className="manual-edits-page__controls app__section app__section--full">
        <div className="manual-edits-page__threshold">
          <label htmlFor={thresholdInputId}>Minimum edited columns</label>
          <div className="manual-edits-page__threshold-inputs">
            <input
              id={thresholdInputId}
              type="number"
              min={1}
              step={1}
              value={minimumColumns}
              onChange={(event) => {
                const nextValue = Number.parseInt(event.target.value, 10);
                setMinimumColumns(Number.isNaN(nextValue) ? 1 : Math.max(1, nextValue));
              }}
              className="manual-edits-page__threshold-input"
            />
            <span className="manual-edits-page__threshold-summary">
              Showing {filteredListings.length.toLocaleString()} of{' '}
              {listingsWithManualEdits.length.toLocaleString()} edited listing
              {listingsWithManualEdits.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="manual-edits-page__threshold-hint">
            Adjust the threshold to focus on properties with more extensive manual changes. Table column
            filters remain available below.
          </p>
        </div>
      </section>
      <section className="manual-edits-page__table">
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
        />
      </section>
    </div>
  );
}

export default ManualEditsPage;
