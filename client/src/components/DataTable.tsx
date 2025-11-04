import { useEffect, useMemo, useRef, useState } from 'react';
import { ArcgisFeature } from '../types';
import { FieldDefinition } from '../utils/fields';
import { getFeatureId } from '../utils/features';

interface DataTableProps {
  fields: FieldDefinition[];
  features: ArcgisFeature[];
  selectedFeatureId: string | null;
  onSelectFeature: (featureId: string | null) => void;
}

const PAGE_SIZE = 25;

function normaliseColumns(
  fields: FieldDefinition[],
  features: ArcgisFeature[],
): FieldDefinition[] {
  if (fields.length) {
    return fields;
  }
  if (features.length) {
    const attributes = features[0].attributes ?? {};
    return Object.keys(attributes).map((name) => ({
      name,
      label: name,
      type: 'unknown',
    }));
  }
  return [];
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

export function DataTable({ fields, features, selectedFeatureId, onSelectFeature }: DataTableProps) {
  const [page, setPage] = useState(0);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const columns = useMemo(() => {
    return normaliseColumns(fields, features);
  }, [fields, features]);

  const featureIds = useMemo(() => features.map((feature) => getFeatureId(feature)), [features]);

  const idToIndex = useMemo(() => {
    const mapping = new Map<string, number>();
    featureIds.forEach((id, index) => {
      mapping.set(id, index);
    });
    return mapping;
  }, [featureIds]);

  const totalPages = Math.max(1, Math.ceil(features.length / PAGE_SIZE));

  const pageFeatures = useMemo(() => {
    const start = page * PAGE_SIZE;
    return features.slice(start, start + PAGE_SIZE);
  }, [features, page]);

  useEffect(() => {
    setPage((prev) => {
      const maxPage = Math.max(0, Math.ceil(features.length / PAGE_SIZE) - 1);
      return Math.min(prev, maxPage);
    });
  }, [features.length]);

  useEffect(() => {
    if (!selectedFeatureId) {
      return;
    }
    const index = idToIndex.get(selectedFeatureId);
    if (index === undefined) {
      return;
    }
    const targetPage = Math.floor(index / PAGE_SIZE);
    if (targetPage !== page) {
      setPage(targetPage);
    }
  }, [selectedFeatureId, idToIndex, page]);

  useEffect(() => {
    if (!selectedFeatureId) {
      return;
    }
    const row = rowRefs.current[selectedFeatureId];
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedFeatureId, pageFeatures]);

  const handlePrev = () => setPage((prev) => Math.max(0, prev - 1));
  const handleNext = () => setPage((prev) => Math.min(totalPages - 1, prev + 1));

  const registerRowRef = (id: string) => (element: HTMLTableRowElement | null) => {
    if (element) {
      rowRefs.current[id] = element;
    } else {
      delete rowRefs.current[id];
    }
  };

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
                <th key={column.name}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageFeatures.map((feature) => {
              const featureId = getFeatureId(feature);
              const isSelected = selectedFeatureId === featureId;
              return (
                <tr
                  key={featureId}
                  ref={registerRowRef(featureId)}
                  className={isSelected ? 'table-row table-row--selected' : 'table-row'}
                  onClick={() => onSelectFeature(isSelected ? null : featureId)}
                >
                  {columns.map((column) => {
                    const attribute = feature.attributes[column.name];
                    return <td key={column.name}>{formatValue(attribute)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
