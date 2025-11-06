import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

import ListingTable from '@/components/ListingTable';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_PAGE_SIZE } from '@/constants/listings';
import {
  createDefaultTableState,
  type ListingTableColumnFilters,
  type ListingTableColumnKey,
} from '@/constants/listingTable';
import { useListings } from '@/context/ListingsContext';
import type { ListingCustomizationOverrides } from '@/services/listingStorage';
import type { ListingRecord } from '@/types';

function decodeParam(value: string | undefined): string {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function OwnerDetailPage(): JSX.Element {
  const { ownerId } = useParams<{ ownerId: string }>();
  const ownerName = decodeParam(ownerId);

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

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [tableState, setTableState] = useState(createDefaultTableState);
  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';
  const editDisabledMessage = 'Connect Supabase to customize listings.';

  const normalizedOwner = useMemo(() => ownerName.trim().toLowerCase(), [ownerName]);

  const matchingListings = useMemo(() => {
    if (!normalizedOwner) {
      return [] as ListingRecord[];
    }

    return listings.filter((listing) =>
      listing.ownerNames.some((name) => name.trim().toLowerCase() === normalizedOwner),
    );
  }, [listings, normalizedOwner]);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedOwner, listings]);

  const complexCount = useMemo(() => {
    const complexes = new Set<string>();
    matchingListings.forEach((listing) => {
      if (listing.complex) {
        complexes.add(listing.complex);
      }
    });
    return complexes.size;
  }, [matchingListings]);

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Refreshing listings from ArcGIS…';
    }
    if (error) {
      return `ArcGIS request failed: ${error}`;
    }
    if (!ownerName) {
      return 'No owner specified.';
    }
    if (listings.length === 0) {
      return 'No ArcGIS listings have been loaded yet.';
    }
    if (matchingListings.length === 0) {
      return `No listings found for “${ownerName}”.`;
    }
    return `Showing ${matchingListings.length.toLocaleString()} listing(s) owned by “${ownerName}”.`;
  }, [error, listings.length, loading, matchingListings.length, ownerName]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  const handleColumnOrderChange = useCallback((order: ListingTableColumnKey[]) => {
    setTableState((previous) => ({
      ...previous,
      columnOrder: [...order],
    }));
  }, []);

  const handleHiddenColumnsChange = useCallback((hidden: ListingTableColumnKey[]) => {
    setTableState((previous) => ({
      ...previous,
      hiddenColumns: [...hidden],
    }));
  }, []);

  const handleColumnFiltersChange = useCallback((filters: ListingTableColumnFilters) => {
    setTableState((previous) => ({
      ...previous,
      columnFilters: { ...filters },
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
        const message =
          error instanceof Error ? error.message : 'Failed to save listing changes.';
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

  return (
    <>
      <div className="detail-sidebar">
        <Link to="/" className="detail-sidebar__back">
          ← All listings
        </Link>
        <h2 className="detail-sidebar__title">{ownerName || 'Unknown owner'}</h2>
        <dl className="detail-sidebar__stats">
          <div>
            <dt>Units</dt>
            <dd>{matchingListings.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Complexes</dt>
            <dd>{complexCount.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
      <div className="detail-table">
        <ListingTable
          listings={matchingListings}
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
          onListingEdit={handleListingEdit}
          onListingRevert={handleListingRevert}
          canToggleFavorites={supabaseConfigured}
          favoriteDisabledReason={favoritesDisabledMessage}
          canEditListings={supabaseConfigured}
          editDisabledReason={editDisabledMessage}
        />
      </div>
    </>
  );
}

export default OwnerDetailPage;
