import './FilterPanel.css';

import { ChangeEvent, useMemo } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  subdivisionOptions: string[];
  stateOptions: string[];
  disabled?: boolean;
}

export function FilterPanel({
  filters,
  onChange,
  subdivisionOptions,
  stateOptions,
  disabled = false,
}: FilterPanelProps) {
  const sortedSubdivisions = useMemo(() => {
    return [...subdivisionOptions].sort((a, b) => a.localeCompare(b));
  }, [subdivisionOptions]);

  const sortedStates = useMemo(() => {
    return [...stateOptions].sort((a, b) => a.localeCompare(b));
  }, [stateOptions]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    if (name === 'searchTerm') {
      onChange({ ...filters, searchTerm: value });
    } else if (name === 'scheduleNumber') {
      onChange({ ...filters, scheduleNumber: value });
    } else if (name === 'mailingCity') {
      onChange({ ...filters, mailingCity: value });
    } else if (name === 'mailingZip') {
      onChange({ ...filters, mailingZip: value });
    }
  };

  const handleStateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    onChange({ ...filters, mailingState: value || '' });
  };

  const handleBusinessChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    const nextValue = value === '' ? null : (value as 'yes' | 'no');
    onChange({ ...filters, businessOwner: nextValue });
  };

  const handleSubdivisionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    onChange({ ...filters, subdivision: value || null });
  };

  const handleReset = () => {
    onChange({
      searchTerm: '',
      scheduleNumber: '',
      mailingCity: '',
      mailingState: '',
      mailingZip: '',
      subdivision: null,
      businessOwner: null,
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
        <label htmlFor="scheduleNumber">Schedule number</label>
        <input
          id="scheduleNumber"
          name="scheduleNumber"
          type="search"
          value={filters.scheduleNumber}
          onChange={handleInputChange}
          placeholder="e.g. 123456"
          disabled={disabled}
          title="Filter listings whose schedule number contains this value"
        />
      </div>

      <fieldset className="filters__group filters__group--grid" disabled={disabled}>
        <legend>Mailing details</legend>
        <label htmlFor="mailingCity" className="filters__field">
          City
          <input
            id="mailingCity"
            name="mailingCity"
            type="search"
            value={filters.mailingCity}
            onChange={handleInputChange}
            placeholder="e.g. Breckenridge"
            title="Filter by mailing city"
          />
        </label>

        <label htmlFor="mailingZip" className="filters__field">
          ZIP
          <input
            id="mailingZip"
            name="mailingZip"
            type="search"
            value={filters.mailingZip}
            onChange={handleInputChange}
            placeholder="e.g. 80424"
            inputMode="numeric"
            title="Filter by mailing ZIP code prefix"
          />
        </label>
      </fieldset>

      <fieldset className="filters__group filters__group--grid" disabled={disabled}>
        <legend>Owner type</legend>
        <label htmlFor="mailingState" className="filters__field">
          State
          <select
            id="mailingState"
            name="mailingState"
            value={filters.mailingState}
            onChange={handleStateChange}
            title="Only show owners with mailing addresses in this state"
          >
            <option value="">All states</option>
            {sortedStates.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="businessOwner" className="filters__field">
          Business owner
          <select
            id="businessOwner"
            name="businessOwner"
            value={filters.businessOwner ?? ''}
            onChange={handleBusinessChange}
            title="Show only owners flagged as businesses"
          >
            <option value="">All owners</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </fieldset>

      <div className="filters__group">
        <label htmlFor="subdivision">Subdivision</label>
        <select
          id="subdivision"
          name="subdivision"
          value={filters.subdivision ?? ''}
          onChange={handleSubdivisionChange}
          disabled={disabled || sortedSubdivisions.length === 0}
          title="Filter by the subdivision reported in ArcGIS"
        >
          <option value="">All subdivisions</option>
          {sortedSubdivisions.map((subdivision) => (
            <option key={subdivision} value={subdivision}>
              {subdivision}
            </option>
          ))}
        </select>
      </div>
    </aside>
  );
}

export default FilterPanel;
