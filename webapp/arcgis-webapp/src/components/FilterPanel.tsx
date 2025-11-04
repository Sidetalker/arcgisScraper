import './FilterPanel.css';

import { ChangeEvent, useMemo } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  subdivisionOptions: string[];
  stateOptions: string[];
  disabled?: boolean;
  onReset: () => void;
  onDropPinRequest: () => void;
  onCancelPinDrop: () => void;
  pinDropActive: boolean;
  hasPinnedRegion: boolean;
  onClearPinRegion: () => void;
}

export function FilterPanel({
  filters,
  onChange,
  subdivisionOptions,
  stateOptions,
  disabled = false,
  onReset,
  onDropPinRequest,
  onCancelPinDrop,
  pinDropActive,
  hasPinnedRegion,
  onClearPinRegion,
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
    } else if (name === 'mailingAddress') {
      onChange({ ...filters, mailingAddress: value });
    } else if (name === 'complex') {
      onChange({ ...filters, complex: value });
    } else if (name === 'owner') {
      onChange({ ...filters, owner: value });
    } else if (name === 'pinRadiusMeters') {
      onChange({ ...filters, pinRadiusMeters: value });
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
    onReset();
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

      <div className="filters__group">
        <label htmlFor="mailingAddress">Mailing address contains</label>
        <input
          id="mailingAddress"
          name="mailingAddress"
          type="search"
          value={filters.mailingAddress}
          onChange={handleInputChange}
          placeholder="Street, city or ZIP"
          disabled={disabled}
          title="Match any part of the mailing address"
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

      <fieldset className="filters__group filters__pin" disabled={disabled}>
        <legend>Map radius filter</legend>
        <div className="filters__pin-row">
          <label htmlFor="pinRadiusMeters">Radius (meters)</label>
          <input
            id="pinRadiusMeters"
            name="pinRadiusMeters"
            type="number"
            min={50}
            step={50}
            value={filters.pinRadiusMeters}
            onChange={handleInputChange}
            placeholder="e.g. 500"
            title="Limit listings to a circle around a dropped pin"
          />
        </div>
        <p className="filters__hint" aria-live="polite">
          {pinDropActive
            ? 'Click anywhere on the map to drop your pin.'
            : hasPinnedRegion
              ? 'Pin placed: adjust the radius or clear the geocircle.'
              : 'Enter a radius and drop a pin on the map to limit results to that area.'}
        </p>
        <div className="filters__pin-actions">
          <button
            type="button"
            onClick={onDropPinRequest}
            disabled={disabled || pinDropActive}
            className="filters__pin-button"
          >
            {pinDropActive ? 'Waiting for map click…' : 'Drop pin on map'}
          </button>
          {pinDropActive ? (
            <button
              type="button"
              onClick={onCancelPinDrop}
              className="filters__pin-button filters__pin-button--secondary"
            >
              Cancel
            </button>
          ) : null}
          {!pinDropActive && hasPinnedRegion ? (
            <button
              type="button"
              onClick={onClearPinRegion}
              className="filters__pin-button filters__pin-button--secondary"
            >
              Clear radius filter
            </button>
          ) : null}
        </div>
      </fieldset>
    </aside>
  );
}

export default FilterPanel;
