import './FilterPanel.css';

import { ChangeEvent, useMemo, useState } from 'react';

import type { ListingFilters } from '@/types';

interface FilterPanelProps {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  disabled?: boolean;
  onReset: () => void;
  watchlistControls?: {
    options: Array<{ id: string; name: string; listingCount: number }>;
    selectedWatchlistId: string | null;
    onSelectWatchlist: (watchlistId: string | null) => void;
    onCreateWatchlist?: () => void | Promise<void>;
    isBusy?: boolean;
    canManage?: boolean;
    createDisabledReason?: string;
    errorMessage?: string | null;
    activeSummary?: { name: string; listingCount: number } | null;
    defaultOptionLabel?: string;
  };
}

export function FilterPanel({
  filters,
  onChange,
  disabled = false,
  onReset,
  watchlistControls,
}: FilterPanelProps) {
  const [isCreatingWatchlist, setIsCreatingWatchlist] = useState(false);
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
    'zones' | 'subdivisions' | 'renewalCategories' | 'renewalMethods' | 'renewalMonths'
  >,
  value: string) => {
    const nextValues = filters[key].filter((item) => item.toLowerCase() !== value.toLowerCase());
    onChange({ ...filters, [key]: nextValues });
  };

  const handleClearInsightFilters = () => {
    onChange({
      ...filters,
      zones: [],
      subdivisions: [],
      renewalCategories: [],
      renewalMethods: [],
      renewalMonths: [],
    });
  };

  const hasInsightFilters =
    filters.zones.length > 0 ||
    filters.subdivisions.length > 0 ||
    filters.renewalCategories.length > 0 ||
    filters.renewalMethods.length > 0 ||
    filters.renewalMonths.length > 0;

  const watchlistSelectOptions = useMemo(() => {
    if (!watchlistControls) {
      return [];
    }
    return watchlistControls.options.map((option) => ({
      ...option,
      label: `${option.name}${
        option.listingCount > 0 ? ` (${option.listingCount.toLocaleString()})` : ''
      }`,
    }));
  }, [watchlistControls]);

  const watchlistDefaultLabel = watchlistControls?.defaultOptionLabel ?? 'Favorites (global)';
  const isWatchlistBusy = watchlistControls?.isBusy ?? false;
  const canManageWatchlists = watchlistControls?.canManage ?? true;
  const isCreateDisabled =
    disabled || isWatchlistBusy || isCreatingWatchlist || !watchlistControls?.onCreateWatchlist || !canManageWatchlists;
  const isSelectDisabled = disabled || isWatchlistBusy;

  const handleWatchlistSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!watchlistControls) {
      return;
    }
    const nextValue = event.target.value;
    const resolved = nextValue.trim().length > 0 ? nextValue : null;
    watchlistControls.onSelectWatchlist(resolved);
  };

  const handleCreateWatchlistClick = async () => {
    if (!watchlistControls?.onCreateWatchlist) {
      return;
    }
    setIsCreatingWatchlist(true);
    try {
      await watchlistControls.onCreateWatchlist();
    } finally {
      setIsCreatingWatchlist(false);
    }
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

      {watchlistControls ? (
        <div className="filters__group filters__group--watchlists">
          <label htmlFor="filters-watchlist-select">Watchlist</label>
          <div className="filters__watchlist-row">
            <select
              id="filters-watchlist-select"
              value={watchlistControls.selectedWatchlistId ?? ''}
              onChange={handleWatchlistSelectChange}
              disabled={isSelectDisabled}
              className="filters__watchlist-select"
            >
              <option value="">{watchlistDefaultLabel}</option>
              {watchlistSelectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="filters__watchlist-create"
              onClick={handleCreateWatchlistClick}
              disabled={isCreateDisabled}
              title={watchlistControls.createDisabledReason}
            >
              New watchlist
            </button>
          </div>
          {watchlistControls.activeSummary ? (
            <p className="filters__watchlist-summary">
              Editing {watchlistControls.activeSummary.name} ·{' '}
              {watchlistControls.activeSummary.listingCount.toLocaleString()} properties
            </p>
          ) : (
            <p className="filters__watchlist-summary">Managing global favorites</p>
          )}
          {watchlistControls.errorMessage ? (
            <p className="filters__watchlist-error" role="alert">
              {watchlistControls.errorMessage}
            </p>
          ) : null}
        </div>
      ) : null}

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
            {filters.zones.map((value) => (
              <button
                key={`zone-${value}`}
                type="button"
                className="filters__chip"
                onClick={() => removeFilterValue('zones', value)}
                disabled={disabled}
              >
                <span className="filters__chip-label">Zone</span>
                <span className="filters__chip-value">{value}</span>
                <span aria-hidden="true" className="filters__chip-remove">
                  ×
                </span>
                <span className="filters__chip-sr">Remove zone filter</span>
              </button>
            ))}
            {filters.subdivisions.map((value) => (
              <button
                key={`subdivision-${value}`}
                type="button"
                className="filters__chip"
                onClick={() => removeFilterValue('subdivisions', value)}
                disabled={disabled}
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
