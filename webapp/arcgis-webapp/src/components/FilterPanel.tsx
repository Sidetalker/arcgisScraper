import './FilterPanel.css';

import { ChangeEvent, useMemo } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  stateOptions: string[];
  disabled?: boolean;
}

export function FilterPanel({ filters, onChange, stateOptions, disabled = false }: FilterPanelProps) {
  const sortedStates = useMemo(() => {
    return [...stateOptions].sort((a, b) => a.localeCompare(b));
  }, [stateOptions]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    onChange({ ...filters, [name]: value });
  };

  const handleStateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...filters, state: event.target.value });
  };

  const handleBusinessChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as ListingFilters['businessType'];
    onChange({ ...filters, businessType: next });
  };

  const handleReset = () => {
    onChange({
      ownerName: '',
      complex: '',
      city: '',
      state: '',
      zip: '',
      subdivision: '',
      scheduleNumber: '',
      unit: '',
      businessType: 'all',
    });
  };

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

      <div className="filters__group">
        <label htmlFor="ownerName">Owner name</label>
        <input
          id="ownerName"
          name="ownerName"
          type="search"
          value={filters.ownerName}
          onChange={handleInputChange}
          placeholder="e.g. Smith"
          disabled={disabled}
          title="Filter by the owner's name or business"
        />
      </div>

      <fieldset className="filters__group filters__group--grid" disabled={disabled}>
        <legend>Property details</legend>
        <label htmlFor="complex" className="filters__field">
          Complex
          <input
            id="complex"
            name="complex"
            type="search"
            value={filters.complex}
            onChange={handleInputChange}
            placeholder="e.g. Mountain Thunder"
            title="Filter by the complex or subdivision name"
          />
        </label>

        <label htmlFor="unit" className="filters__field">
          Unit
          <input
            id="unit"
            name="unit"
            type="search"
            value={filters.unit}
            onChange={handleInputChange}
            placeholder="e.g. 201"
            title="Filter by unit or building identifier"
          />
        </label>

        <label htmlFor="subdivision" className="filters__field">
          Subdivision
          <input
            id="subdivision"
            name="subdivision"
            type="search"
            value={filters.subdivision}
            onChange={handleInputChange}
            placeholder="e.g. Peak 8"
            title="Match a subdivision name"
          />
        </label>

        <label htmlFor="scheduleNumber" className="filters__field">
          Schedule number
          <input
            id="scheduleNumber"
            name="scheduleNumber"
            type="search"
            value={filters.scheduleNumber}
            onChange={handleInputChange}
            placeholder="e.g. 304566"
            title="Filter by Summit County schedule number"
          />
        </label>
      </fieldset>

      <fieldset className="filters__group filters__group--grid" disabled={disabled}>
        <legend>Mailing location</legend>
        <label htmlFor="city" className="filters__field">
          City
          <input
            id="city"
            name="city"
            type="search"
            value={filters.city}
            onChange={handleInputChange}
            placeholder="e.g. Breckenridge"
            title="Filter by mailing city"
          />
        </label>

        <label htmlFor="state" className="filters__field">
          State
          <select
            id="state"
            name="state"
            value={filters.state}
            onChange={handleStateChange}
            disabled={disabled}
            title="Select a specific state to filter by mailing address"
          >
            <option value="">All states</option>
            {sortedStates.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="zip" className="filters__field">
          ZIP code
          <input
            id="zip"
            name="zip"
            type="search"
            value={filters.zip}
            onChange={handleInputChange}
            placeholder="e.g. 80424"
            title="Filter by mailing ZIP code"
          />
        </label>

        <label htmlFor="businessType" className="filters__field">
          Owner type
          <select
            id="businessType"
            name="businessType"
            value={filters.businessType}
            onChange={handleBusinessChange}
            disabled={disabled}
            title="Show only business entities or individual owners"
          >
            <option value="all">All owners</option>
            <option value="individual">Individuals only</option>
            <option value="business">Businesses only</option>
          </select>
        </label>
      </fieldset>
    </aside>
  );
}

export default FilterPanel;
