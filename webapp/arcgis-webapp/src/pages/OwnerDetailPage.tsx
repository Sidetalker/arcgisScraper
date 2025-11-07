import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

import ListingTable from '@/components/ListingTable';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_PAGE_SIZE } from '@/constants/listings';
import {
  createDefaultTableState,
  type ListingTableState,
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
    blacklistedOwners,
    addOwnerToBlacklist,
    removeOwnerFromBlacklist,
  } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [tableState, setTableState] = useState(createDefaultTableState);
  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';
  const editDisabledMessage = 'Connect Supabase to customize listings.';
  const blacklistDisabledMessage = 'Connect Supabase to manage the blacklist.';
  const [isBlacklistPending, setIsBlacklistPending] = useState(false);

  const normalizedOwner = useMemo(() => ownerName.trim().toLowerCase(), [ownerName]);

  const matchingListings = useMemo(() => {
    if (!normalizedOwner) {
      return [] as ListingRecord[];
    }

    return listings.filter((listing) =>
      listing.ownerNames.some((name) => name.trim().toLowerCase() === normalizedOwner),
    );
  }, [listings, normalizedOwner]);

  const isOwnerBlacklisted = useMemo(() => {
    if (!normalizedOwner) {
      return false;
    }
    if (
      blacklistedOwners.some(
        (entry) => entry.ownerNameNormalized === normalizedOwner,
      )
    ) {
      return true;
    }
    return matchingListings.some((listing) => listing.isOwnerBlacklisted);
  }, [blacklistedOwners, matchingListings, normalizedOwner]);

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

  const handleBlacklistToggle = useCallback(async () => {
    if (!normalizedOwner) {
      setStatusMessage('No owner specified.');
      return;
    }

    if (!supabaseConfigured) {
      setStatusMessage(blacklistDisabledMessage);
      return;
    }

    setIsBlacklistPending(true);
    try {
      if (isOwnerBlacklisted) {
        await removeOwnerFromBlacklist(ownerName);
        setStatusMessage('Owner removed from blacklist.');
      } else {
        await addOwnerToBlacklist(ownerName);
        setStatusMessage('Owner added to blacklist.');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update owner blacklist.';
      setStatusMessage(message);
    } finally {
      setIsBlacklistPending(false);
    }
  }, [
    addOwnerToBlacklist,
    blacklistDisabledMessage,
    isOwnerBlacklisted,
    normalizedOwner,
    ownerName,
    removeOwnerFromBlacklist,
    setStatusMessage,
    supabaseConfigured,
  ]);

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
        <div className="detail-sidebar__blacklist">
          <p
            className={`detail-sidebar__blacklist-status${
              isOwnerBlacklisted ? ' detail-sidebar__blacklist-status--active' : ''
            }`}
          >
            {isOwnerBlacklisted
              ? 'This owner is currently blacklisted. All associated properties appear on the Blacklisted tab.'
              : 'Add this owner to the blacklist to prevent outreach to any of their properties.'}
          </p>
          <button
            type="button"
            className={`detail-sidebar__blacklist-button${
              isOwnerBlacklisted ? ' detail-sidebar__blacklist-button--remove' : ''
            }`}
            onClick={() => {
              void handleBlacklistToggle();
            }}
            disabled={!supabaseConfigured || !normalizedOwner || isBlacklistPending}
            aria-busy={isBlacklistPending}
            title={
              !supabaseConfigured
                ? blacklistDisabledMessage
                : !normalizedOwner
                  ? 'Owner name is required.'
                  : isOwnerBlacklisted
                    ? 'Remove this owner from the blacklist'
                    : 'Add this owner to the blacklist'
            }
          >
            {isBlacklistPending
              ? isOwnerBlacklisted
                ? 'Removing…'
                : 'Adding…'
              : isOwnerBlacklisted
                ? 'Remove from blacklist'
                : 'Add to blacklist'}
          </button>
        </div>
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
          commentLinkPath="/"
        />
      </div>
    </>
  );
}

export default OwnerDetailPage;
