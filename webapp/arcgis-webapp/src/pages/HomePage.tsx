import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import FilterPanel from '@/components/FilterPanel';
import ListingTable from '@/components/ListingTable';
import RegionMap from '@/components/RegionMap';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE } from '@/constants/listings';
import { useListings } from '@/context/ListingsContext';
import { applyFilters } from '@/services/listingTransformer';
import type { ListingFilters } from '@/types';

function HomePage(): JSX.Element {
  const { listings, loading, error, regions, onRegionsChange, cachedAt } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, regions]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => applyFilters(listing, filters));
  }, [listings, filters]);

  const subdivisionOptions = useMemo(() => {
    const values = new Set<string>();
    listings.forEach((listing) => {
      if (listing.subdivision) {
        values.add(listing.subdivision);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const stateOptions = useMemo(() => {
    const values = new Set<string>();
    listings.forEach((listing) => {
      if (listing.mailingState) {
        values.add(listing.mailingState);
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const statusMessage = useMemo(() => {
    if (loading) {
      return 'Refreshing listings from ArcGIS…';
    }
    if (error) {
      return `ArcGIS request failed: ${error}`;
    }
    if (listings.length === 0) {
      return 'No ArcGIS listings have been loaded yet.';
    }

    const baseMessage =
      filteredListings.length === listings.length
        ? `Loaded ${listings.length.toLocaleString()} listings.`
        : `Showing ${filteredListings.length.toLocaleString()} of ${listings.length.toLocaleString()} listings after filters.`;

    if (cachedAt) {
      return `${baseMessage} Cached ${cachedAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}.`;
    }

    return baseMessage;
  }, [cachedAt, error, filteredListings.length, loading, listings.length]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  return (
    <>
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        subdivisionOptions={subdivisionOptions}
        stateOptions={stateOptions}
        disabled={loading}
      />
      <div className="app__main">
        <RegionMap regions={regions} onRegionsChange={onRegionsChange} />
        <ListingTable
          listings={filteredListings}
          pageSize={DEFAULT_PAGE_SIZE}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isLoading={loading}
          error={error}
        />
      </div>
    </>
  );
}

export default HomePage;
