import './ListingTable.css';

import { Link } from 'react-router-dom';

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
  const effectivePageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : Math.max(listings.length, 1);
  const totalPages = Math.max(1, Math.ceil(listings.length / effectivePageSize) || 1);
  const clampPage = (value: number) => Math.min(Math.max(value, 1), totalPages);
  const safePage = clampPage(Number.isFinite(currentPage) ? Math.floor(currentPage) : 1);
  const startIndex = (safePage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, listings.length);
  const pageListings = listings.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    const sanitisedPage = Number.isFinite(page) ? Math.floor(page) : safePage;
    onPageChange(clampPage(sanitisedPage));
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
              <th scope="col">Complex</th>
              <th scope="col">Unit</th>
              <th scope="col">Owner(s)</th>
              <th scope="col">Business</th>
              <th scope="col">Mailing address</th>
              <th scope="col">Mailing city</th>
              <th scope="col">State</th>
              <th scope="col">ZIP</th>
              <th scope="col">Subdivision</th>
              <th scope="col">Schedule #</th>
              <th scope="col">Physical address</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={12} className="listing-table__loading">
                  Loading…
                </td>
              </tr>
            ) : pageListings.length === 0 ? (
              <tr>
                <td colSpan={12} className="listing-table__empty">
                  No listings match the current filters.
                </td>
              </tr>
            ) : (
              pageListings.map((listing) => {
                const owners = Array.from(
                  new Set(
                    listing.ownerNames
                      .map((name) => name.trim())
                      .filter((name) => name.length > 0),
                  ),
                );
                const businessLabel = listing.isBusinessOwner ? 'Yes' : 'No';
                const mailingLines = listing.mailingAddress
                  ? listing.mailingAddress.split('\n')
                  : [];
                const zipDisplay = listing.mailingZip9 || listing.mailingZip5 || '—';
                const detailLink = listing.publicDetailUrl ? (
                  <a
                    href={listing.publicDetailUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="listing-table__link"
                  >
                    View
                  </a>
                ) : (
                  '—'
                );

                return (
                  <tr key={listing.id}>
                    <td>
                      {listing.complex ? (
                        <Link
                          to={`/complex/${encodeURIComponent(listing.complex)}`}
                          className="listing-table__link"
                        >
                          {listing.complex}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{listing.unit || '—'}</td>
                    <td>
                      <div className="listing-table__owner">
                        {owners.length > 0 ? (
                          <div className="listing-table__owner-list">
                            {owners.map((owner) => (
                              <Link
                                key={owner}
                                to={`/owner/${encodeURIComponent(owner)}`}
                                className="listing-table__link"
                              >
                                {owner}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          '—'
                        )}
                      </div>
                      {owners.length > 1 ? (
                        <div className="listing-table__owner-count">
                          {owners.length} owners
                        </div>
                      ) : null}
                    </td>
                    <td>{businessLabel}</td>
                    <td>
                      {mailingLines.length ? (
                        <span className="listing-table__multiline">
                          {mailingLines.map((line, index) => (
                            <span key={index}>{line}</span>
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{listing.mailingCity || '—'}</td>
                    <td>{listing.mailingState || '—'}</td>
                    <td>{zipDisplay}</td>
                    <td>{listing.subdivision || '—'}</td>
                    <td>{listing.scheduleNumber || '—'}</td>
                    <td>{listing.physicalAddress || '—'}</td>
                    <td>{detailLink}</td>
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
