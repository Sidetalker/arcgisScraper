import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom';

import ListingTable from '@/components/ListingTable';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_PAGE_SIZE } from '@/constants/listings';
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

function OwnerDetailPage(): JSX.Element {
  const { ownerId } = useParams<{ ownerId: string }>();
  const ownerName = decodeParam(ownerId);
  const location = useLocation();
  const focusListingId =
    (location.state as { focusListingId?: string | null } | null)?.focusListingId ?? null;

  const { listings, loading, error } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [currentPage, setCurrentPage] = useState(1);

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
          pageSize={DEFAULT_PAGE_SIZE}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isLoading={loading}
          error={error}
          focusListingId={focusListingId}
        />
      </div>
    </>
  );
}

export default OwnerDetailPage;
