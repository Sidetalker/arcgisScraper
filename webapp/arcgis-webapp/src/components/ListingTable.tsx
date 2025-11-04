import './ListingTable.css';

import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';

import { createDefaultListingTableViewState, normaliseListingTableViewState } from '@/constants/listingTable';
import type { ListingRecord, ListingTableColumnKey, ListingTableViewState } from '@/types';

interface ListingTableProps {
  listings: ListingRecord[];
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  isLoading: boolean;
  error?: string | null;
  highlightedListingId?: string;
  viewState?: ListingTableViewState;
  onViewStateChange?: (state: ListingTableViewState) => void;
}

interface ColumnDefinition {
  key: ListingTableColumnKey;
  label: string;
  render: (listing: ListingRecord) => ReactNode;
  getFilterValue: (listing: ListingRecord) => string;
}

function toUniqueOwners(listing: ListingRecord): string[] {
  return Array.from(
    new Set(
      listing.ownerNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  );
}

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function fuzzyMatch(haystack: string, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (query.length === 0) {
    return true;
  }

  const source = haystack.toLowerCase();
  let position = 0;

  for (const char of query) {
    const foundIndex = source.indexOf(char, position);
    if (foundIndex === -1) {
      return false;
    }
    position = foundIndex + 1;
  }

  return true;
}

function cloneViewState(state: ListingTableViewState): ListingTableViewState {
  return {
    columnOrder: [...state.columnOrder],
    hiddenColumns: [...state.hiddenColumns],
    columnFilters: { ...state.columnFilters },
  };
}

function areArraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function areColumnFiltersEqual(
  a: ListingTableViewState['columnFilters'],
  b: ListingTableViewState['columnFilters'],
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as ListingTableColumnKey] !== b[key as ListingTableColumnKey]) {
      return false;
    }
  }
  return true;
}

function areViewStatesEqual(a: ListingTableViewState, b: ListingTableViewState): boolean {
  return (
    areArraysEqual(a.columnOrder, b.columnOrder) &&
    areArraysEqual(a.hiddenColumns, b.hiddenColumns) &&
    areColumnFiltersEqual(a.columnFilters, b.columnFilters)
  );
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  {
    key: 'complex',
    label: 'Complex',
    render: (listing) =>
      listing.complex ? (
        <Link to={`/complex/${encodeURIComponent(listing.complex)}`} className="listing-table__link">
          {listing.complex}
        </Link>
      ) : (
        '—'
      ),
    getFilterValue: (listing) => normalizeText(listing.complex),
  },
  {
    key: 'unit',
    label: 'Unit',
    render: (listing) => listing.unit || '—',
    getFilterValue: (listing) => normalizeText(listing.unit),
  },
  {
    key: 'owners',
    label: 'Owner(s)',
    render: (listing) => {
      const owners = toUniqueOwners(listing);
      return (
        <div className="listing-table__owner">
          {owners.length > 0 ? (
            <div className="listing-table__owner-list">
              {owners.map((owner) => (
                <Link
                  key={owner}
                  to={`/owner/${encodeURIComponent(owner)}`}
                  className="listing-table__link"
                >
                  {owner}
                </Link>
              ))}
            </div>
          ) : (
            '—'
          )}
          {owners.length > 1 ? (
            <div className="listing-table__owner-count">{owners.length} owners</div>
          ) : null}
        </div>
      );
    },
    getFilterValue: (listing) => normalizeText(listing.ownerNames.join(' ')),
  },
  {
    key: 'business',
    label: 'Business',
    render: (listing) => (listing.isBusinessOwner ? 'Yes' : 'No'),
    getFilterValue: (listing) => (listing.isBusinessOwner ? 'yes' : 'no'),
  },
  {
    key: 'mailingAddress',
    label: 'Mailing address',
    render: (listing) => {
      const mailingLines = listing.mailingAddress ? listing.mailingAddress.split('\n') : [];
      return mailingLines.length ? (
        <span className="listing-table__multiline">
          {mailingLines.map((line, index) => (
            <span key={index}>{line}</span>
          ))}
        </span>
      ) : (
        '—'
      );
    },
    getFilterValue: (listing) => normalizeText(listing.mailingAddress),
  },
  {
    key: 'mailingCity',
    label: 'Mailing city',
    render: (listing) => listing.mailingCity || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingCity),
  },
  {
    key: 'mailingState',
    label: 'State',
    render: (listing) => listing.mailingState || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingState),
  },
  {
    key: 'mailingZip',
    label: 'ZIP',
    render: (listing) => listing.mailingZip9 || listing.mailingZip5 || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingZip9 || listing.mailingZip5),
  },
  {
    key: 'subdivision',
    label: 'Subdivision',
    render: (listing) => listing.subdivision || '—',
    getFilterValue: (listing) => normalizeText(listing.subdivision),
  },
  {
    key: 'scheduleNumber',
    label: 'Schedule #',
    render: (listing) => listing.scheduleNumber || '—',
    getFilterValue: (listing) => normalizeText(listing.scheduleNumber),
  },
  {
    key: 'physicalAddress',
    label: 'Physical address',
    render: (listing) => listing.physicalAddress || '—',
    getFilterValue: (listing) => normalizeText(listing.physicalAddress),
  },
];

export function ListingTable({
  listings,
  pageSize,
  currentPage,
  onPageChange,
  isLoading,
  error,
  highlightedListingId,
  viewState,
  onViewStateChange,
}: ListingTableProps) {
  const [viewStateInternal, setViewStateInternal] = useState<ListingTableViewState>(() =>
    viewState ? normaliseListingTableViewState(viewState) : createDefaultListingTableViewState(),
  );
  const [dragTarget, setDragTarget] = useState<ListingTableColumnKey | null>(null);
  const dragSource = useRef<ListingTableColumnKey | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const autoScrollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!viewState) {
      return;
    }
    setViewStateInternal((current) => {
      const normalised = normaliseListingTableViewState(viewState);
      return areViewStatesEqual(current, normalised) ? current : normalised;
    });
  }, [viewState]);

  const handleViewStateUpdate = useCallback(
    (
      updater:
        | ListingTableViewState
        | ((state: ListingTableViewState) => ListingTableViewState),
    ) => {
      setViewStateInternal((previous) => {
        const workingState = cloneViewState(previous);
        const proposed =
          typeof updater === 'function'
            ? (updater as (state: ListingTableViewState) => ListingTableViewState)(workingState)
            : updater;
        const nextState = normaliseListingTableViewState(proposed);
        if (areViewStatesEqual(previous, nextState)) {
          return previous;
        }
        onViewStateChange?.(cloneViewState(nextState));
        return nextState;
      });
    },
    [onViewStateChange],
  );

  const { columnOrder, hiddenColumns, columnFilters } = viewStateInternal;

  const updateScrollIndicators = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      setCanScrollRight(false);
      return;
    }
    const canScroll =
      element.scrollLeft + element.clientWidth + 1 < element.scrollWidth;
    setCanScrollRight(canScroll);
  }, []);

  const handleScroll = useCallback(() => {
    updateScrollIndicators();
  }, [updateScrollIndicators]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current !== null) {
      window.clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback(
    (direction: 'left' | 'right') => {
      const element = scrollContainerRef.current;
      if (!element) {
        return;
      }

      stopAutoScroll();
      autoScrollIntervalRef.current = window.setInterval(() => {
        const delta = direction === 'left' ? -20 : 20;
        element.scrollLeft += delta;
      }, 16);
    },
    [stopAutoScroll],
  );

  const scheduleScrollIndicatorUpdate = useCallback(() => {
    if (typeof window === 'undefined') {
      updateScrollIndicators();
      return;
    }
    window.requestAnimationFrame(() => {
      updateScrollIndicators();
    });
  }, [updateScrollIndicators]);

  const columnDefinitionMap = useMemo(() => {
    return new Map<ListingTableColumnKey, ColumnDefinition>(
      COLUMN_DEFINITIONS.map((definition) => [definition.key, definition]),
    );
  }, []);

  const visibleColumns = useMemo(
    () => columnOrder.filter((key) => !hiddenColumns.includes(key)),
    [columnOrder, hiddenColumns],
  );

  const hasActiveColumnFilters = useMemo(
    () => Object.values(columnFilters).some((value) => value.trim().length > 0),
    [columnFilters],
  );

  const filteredListings = useMemo(() => {
    const activeEntries = Object.entries(columnFilters).filter(([, value]) => value.trim().length > 0) as [
      ListingTableColumnKey,
      string,
    ][];

    if (activeEntries.length === 0) {
      return listings;
    }

    return listings.filter((listing) =>
      activeEntries.every(([columnKey, query]) => {
        const column = columnDefinitionMap.get(columnKey);
        if (!column) {
          return true;
        }
        return fuzzyMatch(column.getFilterValue(listing), query);
      }),
    );
  }, [columnDefinitionMap, columnFilters, listings]);

  const effectivePageSize =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.floor(pageSize)
      : Math.max(filteredListings.length, 1);
  const totalPages = Math.max(1, Math.ceil(filteredListings.length / effectivePageSize) || 1);
  const clampPage = (value: number) => Math.min(Math.max(value, 1), totalPages);
  const requestedPage = Number.isFinite(currentPage) ? Math.floor(currentPage) : 1;
  const safePage = clampPage(requestedPage);
  const startIndex = (safePage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, filteredListings.length);
  const pageListings = filteredListings.slice(startIndex, endIndex);
  const columnCount = Math.max(1, visibleColumns.length + 1);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    updateScrollIndicators();
    element.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      element.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      stopAutoScroll();
    };
  }, [handleScroll, updateScrollIndicators, visibleColumns.length, filteredListings.length, stopAutoScroll]);

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  useEffect(() => {
    if (safePage !== requestedPage) {
      onPageChange(safePage);
    }
  }, [requestedPage, safePage, onPageChange]);

  const handlePageChange = (page: number) => {
    const sanitisedPage = Number.isFinite(page) ? Math.floor(page) : safePage;
    onPageChange(clampPage(sanitisedPage));
  };

  const handleFilterChange = useCallback(
    (columnKey: ListingTableColumnKey) => (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      handleViewStateUpdate((current) => {
        if (current.columnFilters[columnKey] === nextValue) {
          return current;
        }
        return {
          ...current,
          columnFilters: {
            ...current.columnFilters,
            [columnKey]: nextValue,
          },
        };
      });
      onPageChange(1);
    },
    [handleViewStateUpdate, onPageChange],
  );

  const handleHideColumn = useCallback(
    (columnKey: ListingTableColumnKey) => {
      handleViewStateUpdate((current) => {
        const alreadyHidden = current.hiddenColumns.includes(columnKey);
        const nextFilters = { ...current.columnFilters };
        if (nextFilters[columnKey]) {
          nextFilters[columnKey] = '';
        }
        return {
          ...current,
          hiddenColumns: alreadyHidden
            ? current.hiddenColumns
            : [...current.hiddenColumns, columnKey],
          columnFilters: nextFilters,
        };
      });
      scheduleScrollIndicatorUpdate();
    },
    [handleViewStateUpdate, scheduleScrollIndicatorUpdate],
  );

  const handleUnhideColumn = useCallback(
    (columnKey: ListingTableColumnKey) => {
      handleViewStateUpdate((current) => ({
        ...current,
        hiddenColumns: current.hiddenColumns.filter((key) => key !== columnKey),
      }));
      scheduleScrollIndicatorUpdate();
    },
    [handleViewStateUpdate, scheduleScrollIndicatorUpdate],
  );

  const handleDragStart = useCallback(
    (columnKey: ListingTableColumnKey) => (event: DragEvent<HTMLButtonElement>) => {
      stopAutoScroll();
      dragSource.current = columnKey;
      setDragTarget(columnKey);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', columnKey);
    },
    [stopAutoScroll],
  );

  const handleDragOver = useCallback(
    (columnKey: ListingTableColumnKey) => (event: DragEvent<HTMLTableCellElement>) => {
      event.preventDefault();
      if (dragTarget !== columnKey) {
        setDragTarget(columnKey);
      }
      event.dataTransfer.dropEffect = 'move';

      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) {
        stopAutoScroll();
        return;
      }

      const rect = scrollElement.getBoundingClientRect();
      const edgeThreshold = 48;
      const offsetLeft = event.clientX - rect.left;
      const offsetRight = rect.right - event.clientX;
      const canScrollLeft = scrollElement.scrollLeft > 0;
      const canScrollRightNow =
        scrollElement.scrollLeft + scrollElement.clientWidth < scrollElement.scrollWidth;

      if (offsetLeft < edgeThreshold && canScrollLeft) {
        startAutoScroll('left');
      } else if (offsetRight < edgeThreshold && canScrollRightNow) {
        startAutoScroll('right');
      } else {
        stopAutoScroll();
      }
    },
    [dragTarget, startAutoScroll, stopAutoScroll],
  );

  const handleDragLeave = useCallback(
    (columnKey: ListingTableColumnKey) => (event: DragEvent<HTMLTableCellElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && event.currentTarget.contains(nextTarget)) {
        return;
      }
      if (dragTarget === columnKey) {
        setDragTarget(null);
      }
      stopAutoScroll();
    },
    [dragTarget, stopAutoScroll],
  );

  const handleDrop = useCallback(
    (columnKey: ListingTableColumnKey) => (event: DragEvent<HTMLTableCellElement>) => {
      event.preventDefault();
      stopAutoScroll();
      const sourceColumn = dragSource.current;
      setDragTarget(null);
      dragSource.current = null;
      if (!sourceColumn || sourceColumn === columnKey) {
        return;
      }

      handleViewStateUpdate((current) => {
        const nextOrder = current.columnOrder.filter((key) => key !== sourceColumn);
        const insertIndex = nextOrder.indexOf(columnKey);
        if (insertIndex === -1) {
          return current;
        }
        nextOrder.splice(insertIndex, 0, sourceColumn);
        return {
          ...current,
          columnOrder: nextOrder,
        };
      });
      scheduleScrollIndicatorUpdate();
    },
    [handleViewStateUpdate, scheduleScrollIndicatorUpdate, stopAutoScroll],
  );

  const handleDragEnd = useCallback(() => {
    dragSource.current = null;
    setDragTarget(null);
    stopAutoScroll();
  }, [stopAutoScroll]);

  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map());
  const registerRow = (id: string) => (element: HTMLTableRowElement | null) => {
    if (element) {
      rowRefs.current.set(id, element);
    } else {
      rowRefs.current.delete(id);
    }
  };

  useEffect(() => {
    if (!highlightedListingId) {
      return;
    }
    const targetRow = rowRefs.current.get(highlightedListingId);
    if (targetRow && typeof targetRow.scrollIntoView === 'function') {
      targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightedListingId, pageListings]);

  const visibleColumnDefinitions = visibleColumns
    .map((columnKey) => columnDefinitionMap.get(columnKey))
    .filter((definition): definition is ColumnDefinition => Boolean(definition));

  const hiddenColumnDefinitions = hiddenColumns
    .map((columnKey) => columnDefinitionMap.get(columnKey))
    .filter((definition): definition is ColumnDefinition => Boolean(definition));

  const totalListingsCount = listings.length;
  const filteredListingsCount = filteredListings.length;
  const summaryText = isLoading
    ? 'Loading listings from ArcGIS…'
    : `Showing ${filteredListingsCount.toLocaleString()} matching listings${
        filteredListingsCount !== totalListingsCount
          ? ` (filtered from ${totalListingsCount.toLocaleString()})`
          : ''
      }`;

  const shouldDisableHide = visibleColumns.length <= 1;

  return (
    <section className="listing-table">
      <header className="listing-table__header">
        <div>
          <h2>Listings</h2>
          <p>{summaryText}</p>
        </div>
        <div className="listing-table__summary">
          <span>
            Page {safePage} of {totalPages}
          </span>
          <span>
            {filteredListingsCount > 0
              ? `Displaying ${startIndex + 1}-${endIndex} of ${filteredListingsCount.toLocaleString()}`
              : 'No rows to display'}
          </span>
        </div>
      </header>

      {error ? (
        <p role="alert" className="listing-table__error">
          {error}
        </p>
      ) : null}

      {hiddenColumnDefinitions.length > 0 ? (
        <div className="listing-table__hidden-columns" aria-live="polite">
          <span>Hidden columns:</span>
          <ul>
            {hiddenColumnDefinitions.map((definition) => (
              <li key={definition.key}>
                <button type="button" onClick={() => handleUnhideColumn(definition.key)}>
                  {definition.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        className={`listing-table__viewport${
          canScrollRight ? ' listing-table__viewport--scrollable-right' : ''
        }`}
        role="region"
        aria-live="polite"
        aria-busy={isLoading}
        title="Tabular summary of listings that match the current filters and map region"
      >
        <div className="listing-table__scroll" ref={scrollContainerRef}>
          <table>
            <thead>
              <tr>
                <th scope="col" className="listing-table__details-header">
                  <span className="visually-hidden">Listing details</span>
                </th>
                {visibleColumnDefinitions.map((definition) => (
                  <th
                    key={definition.key}
                    scope="col"
                    onDragOver={handleDragOver(definition.key)}
                    onDrop={handleDrop(definition.key)}
                    onDragLeave={handleDragLeave(definition.key)}
                    data-drop-target={dragTarget === definition.key}
                  >
                    <div className="listing-table__column-header">
                    <button
                      type="button"
                      className="listing-table__drag-handle"
                      draggable
                      onDragStart={handleDragStart(definition.key)}
                      onDragEnd={handleDragEnd}
                      aria-label={`Drag to reorder the ${definition.label} column`}
                    >
                      <span aria-hidden="true">⋮⋮</span>
                    </button>
                    <span className="listing-table__column-title">{definition.label}</span>
                    <button
                      type="button"
                      className="listing-table__hide-button"
                      onClick={() => handleHideColumn(definition.key)}
                      disabled={shouldDisableHide}
                      aria-label={`Hide the ${definition.label} column`}
                    >
                      Hide
                    </button>
                  </div>
                </th>
              ))}
            </tr>
            <tr className="listing-table__filters">
              <th aria-hidden="true" />
              {visibleColumnDefinitions.map((definition) => (
                <th key={`${definition.key}-filter`}>
                  <label className="listing-table__filter">
                    <span className="visually-hidden">Filter {definition.label}</span>
                    <input
                      type="text"
                      value={columnFilters[definition.key] ?? ''}
                      onChange={handleFilterChange(definition.key)}
                      placeholder="Type to filter…"
                      className="listing-table__filter-input"
                    />
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columnCount} className="listing-table__loading">
                  Loading…
                </td>
              </tr>
            ) : pageListings.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="listing-table__empty">
                  {hasActiveColumnFilters
                    ? 'No listings match the current table filters.'
                    : 'No listings match the current filters.'}
                </td>
              </tr>
            ) : (
              pageListings.map((listing) => {
                return (
                  <tr
                    key={listing.id}
                    ref={registerRow(listing.id)}
                    className={`listing-table__row${
                      highlightedListingId === listing.id ? ' listing-table__row--highlight' : ''
                    }`}
                  >
                    <td className="listing-table__detail-cell">
                      {listing.publicDetailUrl ? (
                        <a
                          href={listing.publicDetailUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="listing-table__detail-link"
                          aria-label="Open listing details in a new tab"
                        >
                          <span aria-hidden="true">ℹ️</span>
                        </a>
                      ) : (
                        <span aria-hidden="true">—</span>
                      )}
                    </td>
                    {visibleColumnDefinitions.map((definition) => (
                      <td key={`${listing.id}-${definition.key}`}>{definition.render(listing)}</td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
        <div
          className={`listing-table__scroll-indicator${
            canScrollRight ? ' listing-table__scroll-indicator--active' : ''
          }`}
          aria-hidden="true"
        >
          <span>Scroll</span>
          <span className="listing-table__scroll-indicator-arrow" aria-hidden="true">
            →
          </span>
        </div>
      </div>

      <nav className="listing-table__pagination" aria-label="Listing pagination">
        <button type="button" onClick={() => handlePageChange(1)} disabled={safePage === 1}>
          « First
        </button>
        <button type="button" onClick={() => handlePageChange(safePage - 1)} disabled={safePage === 1}>
          ‹ Prev
        </button>
        <span>
          Page {safePage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => handlePageChange(safePage + 1)}
          disabled={safePage === totalPages || listings.length === 0}
        >
          Next ›
        </button>
        <button
          type="button"
          onClick={() => handlePageChange(totalPages)}
          disabled={safePage === totalPages || listings.length === 0}
        >
          Last »
        </button>
      </nav>
    </section>
  );
}

export default ListingTable;
