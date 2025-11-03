import { useMemo } from 'react';

export interface FilterPanelProps {
  fields: string[];
  filters: Record<string, string>;
  onFilterChange: (field: string, value: string) => void;
  onReset: () => void;
}

export function FilterPanel({ fields, filters, onFilterChange, onReset }: FilterPanelProps) {
  const sortedFields = useMemo(() => [...fields].sort((a, b) => a.localeCompare(b)), [fields]);

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Filters</h2>
        <button type="button" onClick={onReset} className="secondary">
          Clear Filters
        </button>
      </header>
      <div className="filters-grid">
        {sortedFields.map((field) => (
          <label key={field} className="filter-field">
            <span>{field}</span>
            <input
              type="text"
              value={filters[field] ?? ''}
              onChange={(event) => onFilterChange(field, event.target.value)}
              placeholder="Type to filter"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
