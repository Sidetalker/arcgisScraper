import { useMemo, useState } from 'react';
import { ArcgisFeature } from '../types';

interface DataTableProps {
  features: ArcgisFeature[];
}

const PAGE_SIZE = 25;

export function DataTable({ features }: DataTableProps) {
  const [page, setPage] = useState(0);

  const columns = useMemo(() => {
    if (!features.length) {
      return [] as string[];
    }
    return Object.keys(features[0].attributes ?? {});
  }, [features]);

  const totalPages = Math.max(1, Math.ceil(features.length / PAGE_SIZE));
  const pageFeatures = useMemo(() => {
    const start = page * PAGE_SIZE;
    return features.slice(start, start + PAGE_SIZE);
  }, [features, page]);

  const handlePrev = () => setPage((prev) => Math.max(0, prev - 1));
  const handleNext = () => setPage((prev) => Math.min(totalPages - 1, prev + 1));

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Results ({features.length.toLocaleString()})</h2>
        <div className="pagination">
          <button type="button" onClick={handlePrev} disabled={page === 0}>
            Previous
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button type="button" onClick={handleNext} disabled={page >= totalPages - 1}>
            Next
          </button>
        </div>
      </header>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageFeatures.map((feature, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column}>{String(feature.attributes[column] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
