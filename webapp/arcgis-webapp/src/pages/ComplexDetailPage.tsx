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

function ComplexDetailPage(): JSX.Element {
  const { complexId } = useParams<{ complexId: string }>();
  const complexName = decodeParam(complexId);

  const { listings, loading, error } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [tableState, setTableState] = useState(createDefaultTableState);

  const normalizedComplex = useMemo(() => complexName.trim().toLowerCase(), [complexName]);

  const matchingListings = useMemo(() => {
    if (!normalizedComplex) {
      return [] as ListingRecord[];
    }
    return listings.filter(
      (listing) => listing.complex && listing.complex.toLowerCase() === normalizedComplex,
    );
  }, [listings, normalizedComplex]);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedComplex, listings]);

  const uniqueOwners = useMemo(() => {
    const owners = new Set<string>();
    matchingListings.forEach((listing) => {
      listing.ownerNames.forEach((name) => owners.add(name));
    });
    return owners;
  }, [matchingListings]);

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Refreshing listings from ArcGIS…';
    }
    if (error) {
      return `ArcGIS request failed: ${error}`;
    }
    if (!complexName) {
      return 'No complex specified.';
    }
    if (listings.length === 0) {
      return 'No ArcGIS listings have been loaded yet.';
    }
    if (matchingListings.length === 0) {
      return `No listings found for “${complexName}”.`;
    }
    return `Showing ${matchingListings.length.toLocaleString()} listing(s) for “${complexName}”.`;
  }, [complexName, error, listings.length, loading, matchingListings.length]);

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

  return (
    <>
      <div className="detail-sidebar">
        <Link to="/" className="detail-sidebar__back">
          ← All listings
        </Link>
        <h2 className="detail-sidebar__title">{complexName || 'Unknown complex'}</h2>
        <dl className="detail-sidebar__stats">
          <div>
            <dt>Units</dt>
            <dd>{matchingListings.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Unique owners</dt>
            <dd>{uniqueOwners.size.toLocaleString()}</dd>
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
        />
      </div>
    </>
  );
}

export default ComplexDetailPage;
