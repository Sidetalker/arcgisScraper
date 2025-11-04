import { useEffect, useMemo, useState } from 'react';

import './App.css';
import FilterPanel from './components/FilterPanel';
import ListingTable from './components/ListingTable';
import { fetchListings } from './services/arcgisClient';
import type { ArcgisFeature, ListingAttributes, ListingFilters, ListingRecord } from './types';

const DEFAULT_FILTERS: ListingFilters = {
  searchTerm: '',
  minPrice: null,
  maxPrice: null,
  minBeds: null,
  minBaths: null,
  status: null,
};

const PAGE_SIZE = 25;

const ADDRESS_KEYS = ['SITEADDR', 'SITE_ADDRESS', 'SITEADDRESS', 'Address', 'ADDRESS', 'SITEADD'];
const CITY_KEYS = ['CITY', 'City', 'MUNICIPALITY', 'Town'];
const PRICE_KEYS = ['NightlyRate', 'NIGHTLYRATE', 'AVERAGENIGHTLYRATE', 'AverageNightlyRate', 'PRICE', 'Price'];
const BED_KEYS = ['Bedrooms', 'BEDROOMS', 'BEDS', 'Beds'];
const BATH_KEYS = ['Bathrooms', 'BATHROOMS', 'Baths', 'BATHS'];
const STATUS_KEYS = ['STATUS', 'Status', 'LICENSESTATUS', 'LicenseStatus'];
const OCCUPANCY_KEYS = ['Occupancy', 'OCCUPANCY', 'MaxOccupancy', 'MAXOCCUPANCY'];
const ID_KEYS = ['OBJECTID', 'OBJECTID_1', 'GlobalID', 'GLOBALID', 'License', 'LICENSE'];

function pickString(attributes: ListingAttributes, keys: string[]): string | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(attributes: ListingAttributes, keys: string[]): number | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function toListingRecord(feature: ArcgisFeature<ListingAttributes>, index: number): ListingRecord {
  const attributes = feature.attributes ?? {};
  const idString = pickString(attributes, ID_KEYS);
  const idNumber = pickNumber(attributes, ID_KEYS);
  const id =
    idString ??
    (typeof idNumber === 'number' ? idNumber.toString() : `listing-${attributes.OBJECTID ?? index}`);

  return {
    id,
    address: pickString(attributes, ADDRESS_KEYS) ?? '',
    city: pickString(attributes, CITY_KEYS) ?? '',
    nightlyRate: pickNumber(attributes, PRICE_KEYS),
    bedrooms: pickNumber(attributes, BED_KEYS),
    bathrooms: pickNumber(attributes, BATH_KEYS),
    status: pickString(attributes, STATUS_KEYS),
    occupancy: pickNumber(attributes, OCCUPANCY_KEYS),
    raw: attributes,
  };
}

function applyFilters(listing: ListingRecord, filters: ListingFilters): boolean {
  const search = filters.searchTerm.trim().toLowerCase();
  if (search) {
    const haystack = `${listing.address} ${listing.city}`.toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filters.minPrice !== null) {
    if (listing.nightlyRate === null || listing.nightlyRate < filters.minPrice) {
      return false;
    }
  }

  if (filters.maxPrice !== null) {
    if (listing.nightlyRate === null || listing.nightlyRate > filters.maxPrice) {
      return false;
    }
  }

  if (filters.minBeds !== null) {
    if (listing.bedrooms === null || listing.bedrooms < filters.minBeds) {
      return false;
    }
  }

  if (filters.minBaths !== null) {
    if (listing.bathrooms === null || listing.bathrooms < filters.minBaths) {
      return false;
    }
  }

  if (filters.status) {
    const listingStatus = listing.status ? listing.status.toLowerCase() : '';
    if (listingStatus !== filters.status.toLowerCase()) {
      return false;
    }
  }

  return true;
}

function App(): JSX.Element {
  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchListings({
      filters: { returnGeometry: false },
      signal: controller.signal,
    })
      .then((featureSet) => {
        const features = featureSet.features ?? [];
        const mapped = features.map((feature, index) => toListingRecord(feature, index));
        setListings(mapped);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) {
          return;
        }
        const message =
          fetchError instanceof Error ? fetchError.message : 'Unable to load listings from ArcGIS.';
        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => applyFilters(listing, filters));
  }, [listings, filters]);

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    listings.forEach((listing) => {
      if (listing.status) {
        statuses.add(listing.status);
      }
    });
    return Array.from(statuses);
  }, [listings]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS Web App</h1>
          <p>Explore Summit County short-term rental listings with instant filtering and pagination.</p>
        </div>
      </header>

      <main className="app__content">
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          statusOptions={statusOptions}
          disabled={loading}
        />
        <ListingTable
          listings={filteredListings}
          pageSize={PAGE_SIZE}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isLoading={loading}
          error={error}
        />
      </main>
    </div>
  );
}

export default App;
