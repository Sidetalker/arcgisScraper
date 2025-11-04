import { useCallback } from 'react';
import type { FilterRule } from '../types';

interface FiltersPanelProps {
  availableFields: string[];
  filters: FilterRule[];
  onFiltersChange: (filters: FilterRule[]) => void;
}

export function FiltersPanel({ availableFields, filters, onFiltersChange }: FiltersPanelProps) {
  const handleAddFilter = useCallback(() => {
    if (availableFields.length === 0) {
      return;
    }
    const template: FilterRule = {
      id: crypto.randomUUID?.() ?? `filter-${Math.random().toString(36).slice(2, 10)}`,
      field: availableFields[0],
      value: '',
    };
    onFiltersChange([...filters, template]);
  }, [availableFields, filters, onFiltersChange]);

  const handleFieldChange = useCallback(
    (id: string, field: string) => {
      onFiltersChange(filters.map((filter) => (filter.id === id ? { ...filter, field } : filter)));
    },
    [filters, onFiltersChange]
  );

  const handleValueChange = useCallback(
    (id: string, value: string) => {
      onFiltersChange(filters.map((filter) => (filter.id === id ? { ...filter, value } : filter)));
    },
    [filters, onFiltersChange]
  );

  const handleRemove = useCallback(
    (id: string) => {
      onFiltersChange(filters.filter((filter) => filter.id !== id));
    },
    [filters, onFiltersChange]
  );

  const handleClearAll = useCallback(() => {
    onFiltersChange([]);
  }, [onFiltersChange]);

  if (availableFields.length === 0) {
    return (
      <div className="empty-state">
        Import rental data to begin filtering on the available fields.
      </div>
    );
  }

  return (
    <div className="filters">
      <div className="status-bar">
        <span className="status-pill">{filters.length} active filter{filters.length === 1 ? '' : 's'}</span>
        <button className="secondary-button" onClick={handleAddFilter} type="button">
          + Add filter
        </button>
        {filters.length > 0 ? (
          <button className="secondary-button" onClick={handleClearAll} type="button">
            Clear all
          </button>
        ) : null}
      </div>

      {filters.length === 0 ? (
        <div className="empty-state">No filters applied. Add filters to refine the dataset.</div>
      ) : (
        filters.map((filter) => (
          <div key={filter.id} className="filter-row">
            <select value={filter.field} onChange={(event) => handleFieldChange(filter.id, event.target.value)}>
              {availableFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Contains..."
              value={filter.value}
              onChange={(event) => handleValueChange(filter.id, event.target.value)}
            />
            <button className="secondary-button" type="button" onClick={() => handleRemove(filter.id)}>
              Remove
            </button>
          </div>
        ))
      )}
    </div>
  );
}
