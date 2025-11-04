import './FilterPanel.css';

import { ChangeEvent, useMemo } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  statusOptions: string[];
  disabled?: boolean;
}

function normaliseNumberInput(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function FilterPanel({ filters, onChange, statusOptions, disabled = false }: FilterPanelProps) {
  const sortedStatuses = useMemo(() => {
    return [...statusOptions].sort((a, b) => a.localeCompare(b));
  }, [statusOptions]);

  const handleTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    onChange({ ...filters, searchTerm: value });
  };

  const handleNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    const numericValue = normaliseNumberInput(value);
    if (name === 'minPrice') {
      onChange({ ...filters, minPrice: numericValue });
    } else if (name === 'maxPrice') {
      onChange({ ...filters, maxPrice: numericValue });
    } else if (name === 'minBeds') {
      onChange({ ...filters, minBeds: numericValue });
    } else if (name === 'minBaths') {
      onChange({ ...filters, minBaths: numericValue });
    }
  };

  const handleStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    onChange({ ...filters, status: value || null });
  };

  const handleReset = () => {
    onChange({
      searchTerm: '',
      minPrice: null,
      maxPrice: null,
      minBeds: null,
      minBaths: null,
      status: null,
    });
  };

  return (
    <aside className="filters" aria-label="Filters">
      <div className="filters__header">
        <h2>Filter Listings</h2>
        <button type="button" onClick={handleReset} className="filters__reset" disabled={disabled}>
          Clear all
        </button>
      </div>

      <div className="filters__group">
        <label htmlFor="searchTerm">Search by address</label>
        <input
          id="searchTerm"
          name="searchTerm"
          type="search"
          value={filters.searchTerm}
          onChange={handleTextChange}
          placeholder="e.g. Main St"
          disabled={disabled}
        />
      </div>

      <fieldset className="filters__group filters__group--grid" disabled={disabled}>
        <legend>Nightly rate ($)</legend>
        <label htmlFor="minPrice" className="filters__field">
          Min
          <input
            id="minPrice"
            name="minPrice"
            type="number"
            min={0}
            step={25}
            value={filters.minPrice ?? ''}
            onChange={handleNumberChange}
            inputMode="numeric"
          />
        </label>

        <label htmlFor="maxPrice" className="filters__field">
          Max
          <input
            id="maxPrice"
            name="maxPrice"
            type="number"
            min={0}
            step={25}
            value={filters.maxPrice ?? ''}
            onChange={handleNumberChange}
            inputMode="numeric"
          />
        </label>
      </fieldset>

      <fieldset className="filters__group filters__group--grid" disabled={disabled}>
        <legend>Minimum rooms</legend>
        <label htmlFor="minBeds" className="filters__field">
          Beds
          <input
            id="minBeds"
            name="minBeds"
            type="number"
            min={0}
            step={1}
            value={filters.minBeds ?? ''}
            onChange={handleNumberChange}
            inputMode="numeric"
          />
        </label>

        <label htmlFor="minBaths" className="filters__field">
          Baths
          <input
            id="minBaths"
            name="minBaths"
            type="number"
            min={0}
            step={0.5}
            value={filters.minBaths ?? ''}
            onChange={handleNumberChange}
            inputMode="decimal"
          />
        </label>
      </fieldset>

      <div className="filters__group">
        <label htmlFor="status">License status</label>
        <select
          id="status"
          name="status"
          value={filters.status ?? ''}
          onChange={handleStatusChange}
          disabled={disabled || sortedStatuses.length === 0}
        >
          <option value="">All statuses</option>
          {sortedStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>
    </aside>
  );
}

export default FilterPanel;
