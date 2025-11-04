import { useMemo } from 'react';
import { FieldDefinition } from '../utils/fields';

export interface FilterPanelProps {
  fields: FieldDefinition[];
  filters: Record<string, string>;
  onFilterChange: (field: string, value: string) => void;
  onReset: () => void;
}

export function FilterPanel({ fields, filters, onFilterChange, onReset }: FilterPanelProps) {
  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => a.label.localeCompare(b.label)),
    [fields]
  );

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Filters</h2>
        <button type="button" onClick={onReset} className="secondary">
          Clear Filters
        </button>
      </header>
      <div className="filters-list">
        {sortedFields.map((field) => {
          const inputId = `filter-${field.name}`;
          const helperLabel = field.alias && field.alias !== field.label ? field.alias : field.name;
          return (
            <div key={field.name} className="filter-field">
              <label htmlFor={inputId} className="filter-field__label">
                <span className="filter-field__name">{field.label}</span>
                <span className="filter-field__meta">{helperLabel}</span>
              </label>
              <input
                id={inputId}
                type="text"
                value={filters[field.name] ?? ''}
                onChange={(event) => onFilterChange(field.name, event.target.value)}
                placeholder={`Search ${field.label}`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
