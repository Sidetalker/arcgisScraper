import './FilterPanel.css';

import { ChangeEvent } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  disabled?: boolean;
  onReset: () => void;
}

export function FilterPanel({
  filters,
  onChange,
  disabled = false,
  onReset,
}: FilterPanelProps) {
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    if (name === 'searchTerm') {
      onChange({ ...filters, searchTerm: value });
    } else if (name === 'complex') {
      onChange({ ...filters, complex: value });
    } else if (name === 'owner') {
      onChange({ ...filters, owner: value });
    }
  };

  const handleReset = () => {
    onReset();
  };

  const removeFilterValue = (key: keyof Pick<
    ListingFilters,
    'subdivisions' | 'renewalCategories' | 'renewalMethods' | 'renewalMonths'
  >, value: string) => {
    const nextValues = filters[key].filter((item) => item.toLowerCase() !== value.toLowerCase());
    onChange({ ...filters, [key]: nextValues });
  };

  const handleClearInsightFilters = () => {
    onChange({
      ...filters,
      subdivisions: [],
      renewalCategories: [],
      renewalMethods: [],
      renewalMonths: [],
    });
  };

  const hasInsightFilters =
    filters.subdivisions.length > 0 ||
    filters.renewalCategories.length > 0 ||
    filters.renewalMethods.length > 0 ||
    filters.renewalMonths.length > 0;

  return (
    <aside className="filters" aria-label="Filters">
      <div className="filters__header">
        <h2>Filter Listings</h2>
        <button
          type="button"
          onClick={handleReset}
          className="filters__reset"
          disabled={disabled}
          title="Reset every filter to its default value"
        >
          Clear all
        </button>
      </div>

      {hasInsightFilters ? (
        <div className="filters__group">
          <div className="filters__group-header">
            <span className="filters__group-title">Insight filters</span>
            <button
              type="button"
              className="filters__chip-clear"
              onClick={handleClearInsightFilters}
              disabled={disabled}
            >
              Clear insight filters
            </button>
          </div>
          <div className="filters__chips" role="list">
            {filters.subdivisions.map((value) => (
              <button
                key={`subdivision-${value}`}
                type="button"
                className="filters__chip"
                onClick={() => removeFilterValue('subdivisions', value)}
                disabled={disabled}
                role="listitem"
              >
                <span className="filters__chip-label">Subdivision</span>
                <span className="filters__chip-value">{value}</span>
                <span aria-hidden="true" className="filters__chip-remove">
                  ×
                </span>
                <span className="filters__chip-sr">Remove subdivision filter</span>
              </button>
            ))}
            {filters.renewalCategories.map((value) => (
              <button
                key={`renewal-category-${value}`}
                type="button"
                className="filters__chip"
                onClick={() => removeFilterValue('renewalCategories', value)}
                disabled={disabled}
                role="listitem"
              >
                <span className="filters__chip-label">Renewal urgency</span>
                <span className="filters__chip-value">{value}</span>
                <span aria-hidden="true" className="filters__chip-remove">
                  ×
                </span>
                <span className="filters__chip-sr">Remove renewal urgency filter</span>
              </button>
            ))}
            {filters.renewalMethods.map((value) => (
              <button
                key={`renewal-method-${value}`}
                type="button"
                className="filters__chip"
                onClick={() => removeFilterValue('renewalMethods', value)}
                disabled={disabled}
                role="listitem"
              >
                <span className="filters__chip-label">Renewal signal</span>
                <span className="filters__chip-value">{value}</span>
                <span aria-hidden="true" className="filters__chip-remove">
                  ×
                </span>
                <span className="filters__chip-sr">Remove renewal signal filter</span>
              </button>
            ))}
            {filters.renewalMonths.map((value) => (
              <button
                key={`renewal-month-${value}`}
                type="button"
                className="filters__chip"
                onClick={() => removeFilterValue('renewalMonths', value)}
                disabled={disabled}
                role="listitem"
              >
                <span className="filters__chip-label">Renewal month</span>
                <span className="filters__chip-value">{value}</span>
                <span aria-hidden="true" className="filters__chip-remove">
                  ×
                </span>
                <span className="filters__chip-sr">Remove renewal month filter</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="filters__group">
        <label htmlFor="searchTerm">Search listings</label>
        <input
          id="searchTerm"
          name="searchTerm"
          type="search"
          value={filters.searchTerm}
          onChange={handleInputChange}
          placeholder="Complex, owner, address or subdivision"
          disabled={disabled}
          title="Type a complex, owner, schedule number or address to filter the results instantly"
        />
      </div>

      <div className="filters__group">
        <label htmlFor="complex">Complex name</label>
        <input
          id="complex"
          name="complex"
          type="search"
          value={filters.complex}
          onChange={handleInputChange}
          placeholder="e.g. Mountain Thunder"
          disabled={disabled}
          title="Only show listings whose complex contains this text"
        />
      </div>

      <div className="filters__group">
        <label htmlFor="owner">Owner</label>
        <input
          id="owner"
          name="owner"
          type="search"
          value={filters.owner}
          onChange={handleInputChange}
          placeholder="e.g. Smith"
          disabled={disabled}
          title="Only show listings whose owner names contain this text"
        />
      </div>
    </aside>
  );
}

export default FilterPanel;
