import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import FilterPanel from '@/components/FilterPanel';
import ListingTable from '@/components/ListingTable';
import RegionMap from '@/components/RegionMap';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE } from '@/constants/listings';
import { useListings } from '@/context/ListingsContext';
import { applyFilters } from '@/services/listingTransformer';
import type { ListingFilters, RegionCircle } from '@/types';

function isListingInsideRegions(
  listing: { latitude: number | null; longitude: number | null },
  regions: RegionCircle[],
): boolean {
  if (regions.length === 0) {
    return true;
  }

  if (typeof listing.latitude !== 'number' || typeof listing.longitude !== 'number') {
    return false;
  }

  const { latitude, longitude } = listing;
  const EARTH_RADIUS_METERS = 6_371_000;

  return regions.some((region) => {
    const lat1 = (latitude * Math.PI) / 180;
    const lat2 = (region.lat * Math.PI) / 180;
    const deltaLat = ((region.lat - latitude) * Math.PI) / 180;
    const deltaLng = ((region.lng - longitude) * Math.PI) / 180;

    const haversine =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const distance = 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    return distance <= region.radius;
  });
}

function HomePage(): JSX.Element {
  const { listings, loading, error, regions, onRegionsChange, cachedAt, source } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedListingId, setHighlightedListingId] = useState<string | null>(null);

  const handleRegionsChange = useCallback(
    (nextRegions: RegionCircle[]) => {
      onRegionsChange(nextRegions);
      setHighlightedListingId(null);
    },
    [onRegionsChange],
  );

  const handleFiltersChange = useCallback(
    (nextFilters: ListingFilters) => {
      setFilters(nextFilters);
      setHighlightedListingId(null);
    },
    [],
  );

  const handleResetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    handleRegionsChange([]);
    setHighlightedListingId(null);
  }, [handleRegionsChange]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, regions]);

  const filteredListings = useMemo(() => {
    const filtered = listings.filter((listing) => applyFilters(listing, filters));
    if (regions.length === 0) {
      return filtered;
    }
    return filtered.filter((listing) => isListingInsideRegions(listing, regions));
  }, [filters, listings, regions]);

  const circleListings = useMemo(() => {
    return regions.length > 0 ? filteredListings : [];
  }, [filteredListings, regions.length]);

  useEffect(() => {
    if (!highlightedListingId) {
      return;
    }
    const exists = filteredListings.some((listing) => listing.id === highlightedListingId);
    if (!exists) {
      setHighlightedListingId(null);
    }
  }, [filteredListings, highlightedListingId]);

  const statusMessage = useMemo(() => {
    if (loading) {
      switch (source) {
        case 'local':
          return 'Loading listings from local cache…';
        case 'supabase':
          return 'Loading listings from Supabase…';
        case 'syncing':
          return 'Syncing listings from ArcGIS…';
        default:
          return 'Loading listings…';
      }
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
      return `${baseMessage} Supabase synced ${cachedAt.toLocaleTimeString([], {
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

  const handleListingFocus = useCallback(
    (listingId: string) => {
      const index = filteredListings.findIndex((listing) => listing.id === listingId);
      if (index === -1) {
        return;
      }
      const targetPage = Math.floor(index / DEFAULT_PAGE_SIZE) + 1;
      setCurrentPage(targetPage);
      setHighlightedListingId(listingId);
    },
    [filteredListings],
  );

  return (
    <>
      <FilterPanel
        filters={filters}
        onChange={handleFiltersChange}
        disabled={loading}
        onReset={handleResetFilters}
      />
      <RegionMap
        regions={regions}
        onRegionsChange={handleRegionsChange}
        listings={circleListings}
        onListingSelect={handleListingFocus}
      />
      <div className="app__listings">
        <ListingTable
          listings={filteredListings}
          pageSize={DEFAULT_PAGE_SIZE}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isLoading={loading}
          error={error}
          highlightedListingId={highlightedListingId ?? undefined}
        />
      </div>
    </>
  );
}

export default HomePage;
