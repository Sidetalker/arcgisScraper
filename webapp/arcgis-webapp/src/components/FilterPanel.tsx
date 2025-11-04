import './FilterPanel.css';

import { ChangeEvent, useMemo } from 'react';

import type { ListingFilters, RegionCircle } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  subdivisionOptions: string[];
  stateOptions: string[];
  disabled?: boolean;
  pinRegion?: RegionCircle | null;
  pinDropActive?: boolean;
  onRequestPinDrop?: () => void;
  onCancelPinDrop?: () => void;
  onPinRadiusChange?: (radius: number) => void;
  onClearPinRegion?: () => void;
  defaultPinRadius?: number;
}

export function FilterPanel({
  filters,
  onChange,
  subdivisionOptions,
  stateOptions,
  disabled = false,
  pinRegion = null,
  pinDropActive = false,
  onRequestPinDrop,
  onCancelPinDrop,
  onPinRadiusChange,
  onClearPinRegion,
  defaultPinRadius,
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
    } else if (name === 'mailingAddress') {
      onChange({ ...filters, mailingAddress: value });
    } else if (name === 'complex') {
      onChange({ ...filters, complex: value });
    } else if (name === 'owner') {
      onChange({ ...filters, owner: value });
    } else if (name === 'scheduleNumber') {
      onChange({ ...filters, scheduleNumber: value });
    } else if (name === 'mailingCity') {
      onChange({ ...filters, mailingCity: value });
    } else if (name === 'mailingZip') {
      onChange({ ...filters, mailingZip: value });
    }
  };

  const handlePinRadiusInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const numeric = Number.parseFloat(event.target.value);
    if (Number.isFinite(numeric) && numeric > 0) {
      onPinRadiusChange?.(numeric);
    }
  };

  const handlePinDropClick = () => {
    if (pinDropActive) {
      onCancelPinDrop?.();
    } else {
      onRequestPinDrop?.();
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
      mailingAddress: '',
      complex: '',
      owner: '',
    });
    onClearPinRegion?.();
    onCancelPinDrop?.();
  };

  const radiusPlaceholder = defaultPinRadius
    ? `${Math.round(defaultPinRadius).toLocaleString()} meters`
    : undefined;

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
        <label htmlFor="mailingAddress">Mailing address</label>
        <input
          id="mailingAddress"
          name="mailingAddress"
          type="search"
          value={filters.mailingAddress}
          onChange={handleInputChange}
          placeholder="Street, unit or PO box"
          disabled={disabled}
          title="Filter listings by the owner mailing address"
        />
      </div>

      <div className="filters__group">
        <label htmlFor="complex">Complex</label>
        <input
          id="complex"
          name="complex"
          type="search"
          value={filters.complex}
          onChange={handleInputChange}
          placeholder="e.g. Gold Camp"
          disabled={disabled}
          title="Filter by the reported complex name"
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
          placeholder="Primary owner or business name"
          disabled={disabled}
          title="Filter by an owner's name"
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

      <fieldset className="filters__group filters__geocircle" disabled={disabled}>
        <legend>Map radius filter</legend>
        <div className="filters__pin-actions">
          <button
            type="button"
            className="filters__pin-button"
            onClick={handlePinDropClick}
            disabled={disabled}
          >
            {pinDropActive ? 'Cancel pin drop' : 'Drop a pin on the map'}
          </button>
          <span className="filters__pin-hint" role="status" aria-live="polite">
            {pinDropActive
              ? 'Click anywhere on the map to place your pin.'
              : pinRegion
              ? 'Pin placed on the map.'
              : 'Place a pin to filter by distance.'}
          </span>
        </div>

        <label htmlFor="pinRadius" className="filters__field">
          Radius (meters)
          <input
            id="pinRadius"
            name="pinRadius"
            type="number"
            min="10"
            step="10"
            value={pinRegion ? Math.round(pinRegion.radius) : ''}
            placeholder={radiusPlaceholder}
            onChange={handlePinRadiusInputChange}
            disabled={disabled || !pinRegion}
            title="Limit results to listings within this many meters of the map pin"
          />
        </label>

        <div className="filters__pin-summary" role="status" aria-live="polite">
          {pinRegion ? (
            <>
              <span>
                Pin at {pinRegion.lat.toFixed(5)}, {pinRegion.lng.toFixed(5)} · Radius {Math.round(pinRegion.radius).toLocaleString()}{' '}
                meters
              </span>
              <button
                type="button"
                className="filters__pin-clear"
                onClick={onClearPinRegion}
                disabled={disabled}
              >
                Clear pin filter
              </button>
            </>
          ) : (
            <span>No pin radius filter is active.</span>
          )}
        </div>
      </fieldset>
    </aside>
  );
}

export default FilterPanel;
