import './ListingTable.css';

import type { OwnerRecord } from '@/types';

interface ListingTableProps {
  listings: OwnerRecord[];
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
          <h2>Owner records</h2>
          <p>
            {isLoading
              ? 'Loading owner records from ArcGIS…'
              : `Showing ${listings.length.toLocaleString()} matching owner records`}
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
        title="Tabular summary of owner records that match the current filters and map region"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Complex</th>
              <th scope="col">Unit</th>
              <th scope="col">Owner name</th>
              <th scope="col">Owner type</th>
              <th scope="col">Mailing address</th>
              <th scope="col">City</th>
              <th scope="col">State</th>
              <th scope="col">ZIP (5)</th>
              <th scope="col">ZIP (9)</th>
              <th scope="col">Subdivision</th>
              <th scope="col">Schedule #</th>
              <th scope="col">Public detail</th>
              <th scope="col">Physical address</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={13} className="listing-table__loading">
                  Loading…
                </td>
              </tr>
            ) : pageListings.length === 0 ? (
              <tr>
                <td colSpan={13} className="listing-table__empty">
                  No listings match the current filters.
                </td>
              </tr>
            ) : (
              pageListings.map((listing) => {
                const mailingLines = listing.mailingAddress ? listing.mailingAddress.split('\n') : [];
                return (
                  <tr key={listing.id}>
                    <td>{listing.complex || '—'}</td>
                    <td>{listing.unit || '—'}</td>
                    <td>
                      <div className="listing-table__owner">{listing.ownerName || '—'}</div>
                      {listing.company && listing.ownerName !== listing.company ? (
                        <div className="listing-table__company">{listing.company}</div>
                      ) : null}
                    </td>
                    <td>{listing.businessOwner ? 'Business' : 'Individual'}</td>
                    <td>
                      {mailingLines.length === 0
                        ? '—'
                        : mailingLines.map((line, index) => (
                            <span key={line || index} className="listing-table__mailing-line">
                              {line}
                              {index < mailingLines.length - 1 ? <br /> : null}
                            </span>
                          ))}
                    </td>
                    <td>{listing.city || '—'}</td>
                    <td>{listing.state || '—'}</td>
                    <td>{listing.zip5 || '—'}</td>
                    <td>{listing.zip9 || '—'}</td>
                    <td>{listing.subdivision || '—'}</td>
                    <td>{listing.scheduleNumber || '—'}</td>
                    <td>
                      {listing.publicDetailUrl ? (
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
                      )}
                    </td>
                    <td>{listing.physicalAddress || '—'}</td>
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
