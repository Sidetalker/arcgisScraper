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
  const { listings, loading, error, regions, onRegionsChange, cachedAt } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [currentPage, setCurrentPage] = useState(1);
  const [pinDropMode, setPinDropMode] = useState(false);
  const [pinLocation, setPinLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [highlightedListingId, setHighlightedListingId] = useState<string | null>(null);

  const clampRadius = useCallback((value: number): number => {
    if (!Number.isFinite(value) || value <= 0) {
      return 500;
    }
    const rounded = Math.round(value);
    const minimum = 50;
    const maximum = 50000;
    return Math.min(Math.max(rounded, minimum), maximum);
  }, []);

  const handleRegionsChange = useCallback(
    (nextRegions: RegionCircle[]) => {
      onRegionsChange(nextRegions);
      if (nextRegions.length === 1) {
        const [region] = nextRegions;
        setPinLocation((current) => {
          if (
            current &&
            Math.abs(current.lat - region.lat) < 1e-9 &&
            Math.abs(current.lng - region.lng) < 1e-9
          ) {
            return current;
          }
          return { lat: region.lat, lng: region.lng };
        });
        const roundedRadius = clampRadius(region.radius);
        setFilters((current) => {
          const radiusString = roundedRadius.toString();
          if (current.pinRadiusMeters === radiusString) {
            return current;
          }
          return { ...current, pinRadiusMeters: radiusString };
        });
      } else if (nextRegions.length === 0) {
        setPinLocation(null);
      } else {
        setPinLocation(null);
      }
    },
    [clampRadius, onRegionsChange],
  );

  const handleFiltersChange = useCallback(
    (nextFilters: ListingFilters) => {
      const previousRadius = filters.pinRadiusMeters;
      let adjustedFilters = nextFilters;
      let resolvedRadius: number | null = null;

      const rawRadius = Number.parseFloat(nextFilters.pinRadiusMeters);
      if (Number.isFinite(rawRadius) && rawRadius > 0) {
        const safeRadius = clampRadius(rawRadius);
        resolvedRadius = safeRadius;
        if (safeRadius.toString() !== nextFilters.pinRadiusMeters) {
          adjustedFilters = { ...nextFilters, pinRadiusMeters: safeRadius.toString() };
        }
      }

      setFilters(adjustedFilters);
      setHighlightedListingId(null);

      if (
        pinLocation &&
        nextFilters.pinRadiusMeters !== previousRadius &&
        resolvedRadius !== null
      ) {
        handleRegionsChange([
          { lat: pinLocation.lat, lng: pinLocation.lng, radius: resolvedRadius },
        ]);
      }
    },
    [clampRadius, filters.pinRadiusMeters, handleRegionsChange, pinLocation],
  );

  const handleDropPinRequest = useCallback(() => {
    setPinDropMode(true);
  }, []);

  const handleCancelPinDrop = useCallback(() => {
    setPinDropMode(false);
  }, []);

  const handlePinLocationSelected = useCallback(
    (location: { lat: number; lng: number }) => {
      const rawRadius = Number.parseFloat(filters.pinRadiusMeters);
      const safeRadius = clampRadius(Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 500);
      if (!Number.isFinite(rawRadius) || rawRadius <= 0 || safeRadius.toString() !== filters.pinRadiusMeters) {
        setFilters((current) => {
          const radiusString = safeRadius.toString();
          if (current.pinRadiusMeters === radiusString) {
            return current;
          }
          return { ...current, pinRadiusMeters: radiusString };
        });
      }
      setPinDropMode(false);
      handleRegionsChange([{ lat: location.lat, lng: location.lng, radius: safeRadius }]);
    },
    [clampRadius, filters.pinRadiusMeters, handleRegionsChange],
  );

  const handleClearPin = useCallback(() => {
    setPinDropMode(false);
    setPinLocation(null);
    handleRegionsChange([]);
  }, [handleRegionsChange]);

  const handleResetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setPinDropMode(false);
    setPinLocation(null);
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

  const subdivisionOptions = useMemo(() => {
    const values = new Set<string>();
    listings.forEach((listing) => {
      if (listing.subdivision) {
        values.add(listing.subdivision);
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
    if (pinDropMode) {
      setStatusMessage('Click the map to drop your pin, then adjust the radius as needed.');
      return;
    }
    setStatusMessage(statusMessage);
  }, [pinDropMode, setStatusMessage, statusMessage]);

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
        subdivisionOptions={subdivisionOptions}
        disabled={loading}
        onReset={handleResetFilters}
        onDropPinRequest={handleDropPinRequest}
        onCancelPinDrop={handleCancelPinDrop}
        pinDropActive={pinDropMode}
        hasPinnedRegion={Boolean(pinLocation)}
        onClearPinRegion={handleClearPin}
      />
      <div className="app__main">
        <RegionMap
          regions={regions}
          onRegionsChange={handleRegionsChange}
          pinDropMode={pinDropMode}
          onPinLocationSelect={handlePinLocationSelected}
          listings={circleListings}
          onListingSelect={handleListingFocus}
        />
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
