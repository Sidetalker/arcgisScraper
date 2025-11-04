import './ListingTable.css';

import type { ListingRecord } from '@/types';

interface ListingTableProps {
  listings: ListingRecord[];
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  isLoading: boolean;
  error?: string | null;
}

export function ListingTable({
  listings,
  pageSize,
  currentPage,
  onPageChange,
  isLoading,
  error,
}: ListingTableProps) {
  const totalPages = Math.max(1, Math.ceil(listings.length / pageSize) || 1);
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, listings.length);
  const pageListings = listings.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    onPageChange(nextPage);
  };

  return (
    <section className="listing-table">
      <header className="listing-table__header">
        <div>
          <h2>Listings</h2>
          <p>
            {isLoading
              ? 'Loading listings from ArcGIS…'
              : `Showing ${listings.length.toLocaleString()} matching listings`}
          </p>
        </div>
        <div className="listing-table__summary">
          <span>
            Page {safePage} of {totalPages}
          </span>
          <span>
            {listings.length > 0
              ? `Displaying ${startIndex + 1}-${endIndex} of ${listings.length.toLocaleString()}`
              : 'No rows to display'}
          </span>
        </div>
      </header>

      {error ? (
        <p role="alert" className="listing-table__error">
          {error}
        </p>
      ) : null}

      <div
        className="listing-table__viewport"
        role="region"
        aria-live="polite"
        aria-busy={isLoading}
        title="Tabular summary of listings that match the current filters and map region"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Address</th>
              <th scope="col">City</th>
              <th scope="col">Nightly rate</th>
              <th scope="col">Beds</th>
              <th scope="col">Baths</th>
              <th scope="col">Status</th>
              <th scope="col">Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="listing-table__loading">
                  Loading…
                </td>
              </tr>
            ) : pageListings.length === 0 ? (
              <tr>
                <td colSpan={7} className="listing-table__empty">
                  No listings match the current filters.
                </td>
              </tr>
            ) : (
              pageListings.map((listing) => {
                const nightlyRate =
                  listing.nightlyRate === null
                    ? '—'
                    : `$${listing.nightlyRate.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}`;

                const beds =
                  listing.bedrooms === null
                    ? '—'
                    : listing.bedrooms.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      });
                const baths =
                  listing.bathrooms === null
                    ? '—'
                    : listing.bathrooms.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      });
                const occupancy =
                  listing.occupancy === null
                    ? '—'
                    : listing.occupancy.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      });

                return (
                  <tr key={listing.id}>
                    <td>
                      <div className="listing-table__address">{listing.address || 'Address unavailable'}</div>
                    </td>
                    <td>{listing.city || '—'}</td>
                    <td>{nightlyRate}</td>
                    <td>{beds}</td>
                    <td>{baths}</td>
                    <td>{listing.status || '—'}</td>
                    <td>{occupancy}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <nav className="listing-table__pagination" aria-label="Listing pagination">
        <button type="button" onClick={() => handlePageChange(1)} disabled={safePage === 1}>
          « First
        </button>
        <button type="button" onClick={() => handlePageChange(safePage - 1)} disabled={safePage === 1}>
          ‹ Prev
        </button>
        <span>
          Page {safePage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => handlePageChange(safePage + 1)}
          disabled={safePage === totalPages || listings.length === 0}
        >
          Next ›
        </button>
        <button
          type="button"
          onClick={() => handlePageChange(totalPages)}
          disabled={safePage === totalPages || listings.length === 0}
        >
          Last »
        </button>
      </nav>
    </section>
  );
}

export default ListingTable;
