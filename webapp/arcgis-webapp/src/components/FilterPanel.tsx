import './FilterPanel.css';

import { ChangeEvent } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
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
  disabled = false,
  onReset,
  onDropPinRequest,
  onCancelPinDrop,
  pinDropActive,
  hasPinnedRegion,
  onClearPinRegion,
}: FilterPanelProps) {
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    if (name === 'searchTerm') {
      onChange({ ...filters, searchTerm: value });
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
