import './ListingTable.css';

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';

import {
  type ListingTableColumnFilters,
  type ListingTableColumnKey,
} from '@/constants/listingTable';
import type { ListingRecord } from '@/types';

interface ListingTableProps {
  listings: ListingRecord[];
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  isLoading: boolean;
  error?: string | null;
  highlightedListingId?: string;
  columnOrder: ListingTableColumnKey[];
  hiddenColumns: ListingTableColumnKey[];
  columnFilters: ListingTableColumnFilters;
  onColumnOrderChange: (order: ListingTableColumnKey[]) => void;
  onHiddenColumnsChange: (hidden: ListingTableColumnKey[]) => void;
  onColumnFiltersChange: (filters: ListingTableColumnFilters) => void;
}

type ColumnKey = ListingTableColumnKey;

interface ColumnDefinition {
  key: ColumnKey;
  label: string;
  render: (listing: ListingRecord) => ReactNode;
  getFilterValue: (listing: ListingRecord) => string;
  getExportValue: (listing: ListingRecord) => string;
  filterType?: 'text' | 'boolean';
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
    getExportValue: (listing) => normalizeText(listing.complex),
  },
  {
    key: 'unit',
    label: 'Unit',
    render: (listing) => listing.unit || '—',
    getFilterValue: (listing) => normalizeText(listing.unit),
    getExportValue: (listing) => normalizeText(listing.unit),
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
    getExportValue: (listing) => toUniqueOwners(listing).join('; '),
  },
  {
    key: 'business',
    label: 'Business-owned',
    render: (listing) => (listing.isBusinessOwner ? 'Yes' : 'No'),
    getFilterValue: (listing) => (listing.isBusinessOwner ? 'yes' : 'no'),
    getExportValue: (listing) => (listing.isBusinessOwner ? 'Yes' : 'No'),
    filterType: 'boolean',
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
    getExportValue: (listing) => normalizeText(listing.mailingAddress?.replace(/\n/g, ', ') ?? ''),
  },
  {
    key: 'mailingCity',
    label: 'Mailing city',
    render: (listing) => listing.mailingCity || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingCity),
    getExportValue: (listing) => normalizeText(listing.mailingCity),
  },
  {
    key: 'mailingState',
    label: 'State',
    render: (listing) => listing.mailingState || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingState),
    getExportValue: (listing) => normalizeText(listing.mailingState),
  },
  {
    key: 'mailingZip',
    label: 'ZIP',
    render: (listing) => listing.mailingZip9 || listing.mailingZip5 || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingZip9 || listing.mailingZip5),
    getExportValue: (listing) =>
      normalizeText(listing.mailingZip9 || listing.mailingZip5 || ''),
  },
  {
    key: 'subdivision',
    label: 'Subdivision',
    render: (listing) => listing.subdivision || '—',
    getFilterValue: (listing) => normalizeText(listing.subdivision),
    getExportValue: (listing) => normalizeText(listing.subdivision),
  },
  {
    key: 'scheduleNumber',
    label: 'Schedule #',
    render: (listing) => listing.scheduleNumber || '—',
    getFilterValue: (listing) => normalizeText(listing.scheduleNumber),
    getExportValue: (listing) => normalizeText(listing.scheduleNumber),
  },
  {
    key: 'physicalAddress',
    label: 'Physical address',
    render: (listing) => listing.physicalAddress || '—',
    getFilterValue: (listing) => normalizeText(listing.physicalAddress),
    getExportValue: (listing) => normalizeText(listing.physicalAddress),
  },
];

const MAX_PAGE_SIZE = 1000;

export function ListingTable({
  listings,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  isLoading,
  error,
  highlightedListingId,
  columnOrder,
  hiddenColumns,
  columnFilters,
  onColumnOrderChange,
  onHiddenColumnsChange,
  onColumnFiltersChange,
}: ListingTableProps) {
  const [dragTarget, setDragTarget] = useState<ColumnKey | null>(null);
  const dragSource = useRef<ColumnKey | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const autoScrollIntervalRef = useRef<number | null>(null);
  const [isColumnPanelOpen, setIsColumnPanelOpen] = useState(false);
  const columnPanelRef = useRef<HTMLDivElement | null>(null);
  const columnPanelListRef = useRef<HTMLUListElement | null>(null);
  const columnPanelDragSource = useRef<ColumnKey | null>(null);
  const [columnPanelDragTarget, setColumnPanelDragTarget] = useState<ColumnKey | null>(null);
  const [columnPanelActiveDragSource, setColumnPanelActiveDragSource] = useState<ColumnKey | null>(
    null,
  );
  const pageSizeInputId = useId();
  const pageJumpInputId = useId();
  const [pageSizeInputValue, setPageSizeInputValue] = useState(() => pageSize.toString());
  const [isPageJumpOpen, setIsPageJumpOpen] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');
  const pageJumpContainerRef = useRef<HTMLDivElement | null>(null);
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null);

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
    (element: HTMLElement | null, direction: 'left' | 'right' | 'up' | 'down') => {
      if (!element) {
        return;
      }

      stopAutoScroll();
      autoScrollIntervalRef.current = window.setInterval(() => {
        const delta = 20;
        switch (direction) {
          case 'left':
            element.scrollLeft -= delta;
            break;
          case 'right':
            element.scrollLeft += delta;
            break;
          case 'up':
            element.scrollTop -= delta;
            break;
          case 'down':
            element.scrollTop += delta;
            break;
        }
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
    return new Map<ColumnKey, ColumnDefinition>(
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
      ColumnKey,
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
        if (column.filterType === 'boolean') {
          if (query === 'all') {
            return true;
          }
          const candidate = column.getFilterValue(listing);
          return candidate === query;
        }
        return fuzzyMatch(column.getFilterValue(listing), query);
      }),
    );
  }, [columnDefinitionMap, columnFilters, listings]);

  const fallbackPageSize = filteredListings.length > 0 ? filteredListings.length : 1;
  const resolvedPageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : fallbackPageSize;
  const effectivePageSize = Math.min(Math.max(resolvedPageSize, 1), MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filteredListings.length / effectivePageSize) || 1);
  const clampPage = (value: number) => Math.min(Math.max(value, 1), totalPages);
  const requestedPage = Number.isFinite(currentPage) ? Math.floor(currentPage) : 1;
  const safePage = clampPage(requestedPage);
  const startIndex = (safePage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, filteredListings.length);
  const pageListings = filteredListings.slice(startIndex, endIndex);
  const columnCount = Math.max(1, visibleColumns.length);

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

  useEffect(() => {
    setPageSizeInputValue(pageSize.toString());
  }, [pageSize]);

  const handlePageChange = (page: number) => {
    const sanitisedPage = Number.isFinite(page) ? Math.floor(page) : safePage;
    onPageChange(clampPage(sanitisedPage));
  };

  const closePageJump = useCallback(() => {
    setIsPageJumpOpen(false);
    setPageJumpValue('');
  }, []);

  const openPageJump = useCallback(() => {
    setPageJumpValue(safePage.toString());
    setIsPageJumpOpen(true);
  }, [safePage]);

  const handlePageJumpToggle = useCallback(() => {
    if (isPageJumpOpen) {
      closePageJump();
      return;
    }
    openPageJump();
  }, [isPageJumpOpen, closePageJump, openPageJump]);

  useEffect(() => {
    if (!isPageJumpOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const input = pageJumpInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isPageJumpOpen]);

  useEffect(() => {
    if (!isPageJumpOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (pageJumpContainerRef.current?.contains(event.target as Node)) {
        return;
      }
      closePageJump();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePageJump();
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPageJumpOpen, closePageJump]);

  useEffect(() => {
    if (isPageJumpOpen) {
      setPageJumpValue(safePage.toString());
    }
  }, [safePage, isPageJumpOpen]);

  const commitPageSize = useCallback(() => {
    const trimmed = pageSizeInputValue.trim();
    const parsed = Number.parseInt(trimmed, 10);

    if (!Number.isFinite(parsed)) {
      setPageSizeInputValue(pageSize.toString());
      return;
    }

    const clamped = Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);

    if (clamped !== pageSize) {
      onPageSizeChange(clamped);
      if (safePage !== 1) {
        onPageChange(1);
      }
    }

    setPageSizeInputValue(clamped.toString());
  }, [pageSizeInputValue, pageSize, onPageSizeChange, safePage, onPageChange]);

  const handlePageSizeSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      commitPageSize();
    },
    [commitPageSize],
  );

  const handlePageSizeInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPageSizeInputValue(event.target.value);
    },
    [],
  );

  const handlePageSizeBlur = useCallback(() => {
    commitPageSize();
  }, [commitPageSize]);

  const handlePageJumpInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value.replace(/[^0-9]/g, '');
      setPageJumpValue(nextValue);
    },
    [],
  );

  const handlePageJumpSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (pageJumpValue.trim().length === 0) {
        closePageJump();
        return;
      }

      const parsed = Number.parseInt(pageJumpValue, 10);

      if (Number.isFinite(parsed)) {
        const target = Math.min(Math.max(parsed, 1), totalPages);
        onPageChange(target);
      }

      closePageJump();
    },
    [pageJumpValue, totalPages, onPageChange, closePageJump],
  );

  const handleFilterChange = useCallback(
    (columnKey: ColumnKey, options?: { normalize?: (value: string) => string }) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const rawValue = event.target.value;
        const nextValue = options?.normalize ? options.normalize(rawValue) : rawValue;
        if (columnFilters[columnKey] === nextValue) {
          return;
        }
        onColumnFiltersChange({ ...columnFilters, [columnKey]: nextValue });
        onPageChange(1);
      },
    [columnFilters, onColumnFiltersChange, onPageChange],
  );

  const handleHideColumn = useCallback(
    (columnKey: ColumnKey) => {
      if (!hiddenColumns.includes(columnKey)) {
        onHiddenColumnsChange([...hiddenColumns, columnKey]);
      }
      if (columnFilters[columnKey]) {
        onColumnFiltersChange({ ...columnFilters, [columnKey]: '' });
      }
      scheduleScrollIndicatorUpdate();
    },
    [
      columnFilters,
      hiddenColumns,
      onColumnFiltersChange,
      onHiddenColumnsChange,
      scheduleScrollIndicatorUpdate,
    ],
  );

  const handleUnhideColumn = useCallback(
    (columnKey: ColumnKey) => {
      if (!hiddenColumns.includes(columnKey)) {
        return;
      }
      onHiddenColumnsChange(hiddenColumns.filter((key) => key !== columnKey));
      scheduleScrollIndicatorUpdate();
    },
    [hiddenColumns, onHiddenColumnsChange, scheduleScrollIndicatorUpdate],
  );

  const handleToggleColumnVisibility = useCallback(
    (columnKey: ColumnKey, shouldShow: boolean) => {
      if (shouldShow) {
        handleUnhideColumn(columnKey);
      } else {
        handleHideColumn(columnKey);
      }
    },
    [handleHideColumn, handleUnhideColumn],
  );

  const handleColumnPanelDragStart = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLButtonElement>) => {
      columnPanelDragSource.current = columnKey;
      setColumnPanelDragTarget(columnKey);
      setColumnPanelActiveDragSource(columnKey);
      stopAutoScroll();
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', columnKey);
      if (typeof document !== 'undefined') {
        const sourceItem = event.currentTarget.closest('li');
        if (sourceItem) {
          const sourceRect = sourceItem.getBoundingClientRect();
          const dragImage = sourceItem.cloneNode(true) as HTMLElement;
          dragImage.style.position = 'absolute';
          dragImage.style.top = '-9999px';
          dragImage.style.left = '-9999px';
          dragImage.style.width = `${sourceRect.width}px`;
          dragImage.classList.add('listing-table__column-panel-drag-image');
          document.body.appendChild(dragImage);
          event.dataTransfer.setDragImage(dragImage, sourceRect.width / 2, sourceRect.height / 2);
          const removeDragImage = () => {
            if (dragImage.parentNode) {
              dragImage.parentNode.removeChild(dragImage);
            }
          };
          setTimeout(removeDragImage, 0);
        }
      }
    },
    [stopAutoScroll],
  );

  const handleColumnPanelDragOver = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (columnPanelDragTarget !== columnKey) {
        setColumnPanelDragTarget(columnKey);
      }
      const listElement = columnPanelListRef.current;
      if (!listElement) {
        stopAutoScroll();
        return;
      }

      const rect = listElement.getBoundingClientRect();
      const edgeThreshold = 48;
      const offsetTop = event.clientY - rect.top;
      const offsetBottom = rect.bottom - event.clientY;
      const canScrollUp = listElement.scrollTop > 0;
      const canScrollDown =
        listElement.scrollTop + listElement.clientHeight < listElement.scrollHeight;

      if (offsetTop < edgeThreshold && canScrollUp) {
        startAutoScroll(listElement, 'up');
      } else if (offsetBottom < edgeThreshold && canScrollDown) {
        startAutoScroll(listElement, 'down');
      } else {
        stopAutoScroll();
      }
    },
    [columnPanelDragTarget, startAutoScroll, stopAutoScroll],
  );

  const handleColumnPanelDragLeave = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLLIElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && event.currentTarget.contains(nextTarget)) {
        return;
      }
      if (columnPanelDragTarget === columnKey) {
        setColumnPanelDragTarget(null);
      }
      stopAutoScroll();
    },
    [columnPanelDragTarget, stopAutoScroll],
  );

  const handleColumnPanelDrop = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      const sourceColumn = columnPanelDragSource.current;
      setColumnPanelDragTarget(null);
      columnPanelDragSource.current = null;
      setColumnPanelActiveDragSource(null);
      stopAutoScroll();
      if (!sourceColumn || sourceColumn === columnKey) {
        return;
      }

      const nextOrder = columnOrder.filter((key) => key !== sourceColumn);
      const insertIndex = nextOrder.indexOf(columnKey);
      if (insertIndex === -1) {
        nextOrder.push(sourceColumn);
      } else {
        nextOrder.splice(insertIndex, 0, sourceColumn);
      }

      onColumnOrderChange([...nextOrder]);
      scheduleScrollIndicatorUpdate();
    },
    [columnOrder, onColumnOrderChange, scheduleScrollIndicatorUpdate, stopAutoScroll],
  );

  const handleColumnPanelDragEnd = useCallback(() => {
    columnPanelDragSource.current = null;
    setColumnPanelDragTarget(null);
    setColumnPanelActiveDragSource(null);
    stopAutoScroll();
  }, [stopAutoScroll]);

  useEffect(() => {
    if (!isColumnPanelOpen) {
      return;
    }
    if (typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const panel = columnPanelRef.current;
      if (!panel) {
        return;
      }
      const target = event.target as Node | null;
      if (target && panel.contains(target)) {
        return;
      }
      setIsColumnPanelOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isColumnPanelOpen]);

  useEffect(() => {
    if (!isColumnPanelOpen) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsColumnPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isColumnPanelOpen]);

  useEffect(() => {
    if (!isColumnPanelOpen) {
      setColumnPanelDragTarget(null);
      setColumnPanelActiveDragSource(null);
      stopAutoScroll();
    }
  }, [isColumnPanelOpen, stopAutoScroll]);

  const handleDragStart = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLButtonElement>) => {
      stopAutoScroll();
      dragSource.current = columnKey;
      setDragTarget(columnKey);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', columnKey);
    },
    [stopAutoScroll],
  );

  const handleDragOver = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLTableCellElement>) => {
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
        startAutoScroll(scrollElement, 'left');
      } else if (offsetRight < edgeThreshold && canScrollRightNow) {
        startAutoScroll(scrollElement, 'right');
      } else {
        stopAutoScroll();
      }
    },
    [dragTarget, startAutoScroll, stopAutoScroll],
  );

  const handleDragLeave = useCallback(
    (columnKey: ColumnKey) => (event: DragEvent<HTMLTableCellElement>) => {
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
    (columnKey: ColumnKey) => (event: DragEvent<HTMLTableCellElement>) => {
      event.preventDefault();
      stopAutoScroll();
      const sourceColumn = dragSource.current;
      setDragTarget(null);
      dragSource.current = null;
      if (!sourceColumn || sourceColumn === columnKey) {
        return;
      }

      const nextOrder = columnOrder.filter((key) => key !== sourceColumn);
      const insertIndex = nextOrder.indexOf(columnKey);
      if (insertIndex === -1) {
        return;
      }
      nextOrder.splice(insertIndex, 0, sourceColumn);
      onColumnOrderChange([...nextOrder]);
      scheduleScrollIndicatorUpdate();
    },
    [columnOrder, onColumnOrderChange, scheduleScrollIndicatorUpdate, stopAutoScroll],
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

  const panelColumnDefinitions = useMemo(() => {
    const orderedDefinitions = columnOrder
      .map((columnKey) => columnDefinitionMap.get(columnKey))
      .filter((definition): definition is ColumnDefinition => Boolean(definition));
    const hiddenSet = new Set(hiddenColumns);
    const visible = orderedDefinitions.filter((definition) => !hiddenSet.has(definition.key));
    const hiddenList = orderedDefinitions.filter((definition) => hiddenSet.has(definition.key));
    return [...visible, ...hiddenList];
  }, [columnDefinitionMap, columnOrder, hiddenColumns]);

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
  const visibleColumnsCount = visibleColumns.length;

  const handleExportCsv = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const exportColumnDefinitions = columnOrder
      .filter((key) => !hiddenColumns.includes(key))
      .map((key) => columnDefinitionMap.get(key))
      .filter((definition): definition is ColumnDefinition => Boolean(definition));

    if (exportColumnDefinitions.length === 0) {
      return;
    }

    const rows: string[][] = [
      exportColumnDefinitions.map((definition) => definition.label),
      ...filteredListings.map((listing) =>
        exportColumnDefinitions.map((definition) => definition.getExportValue(listing)),
      ),
    ];

    const csvContent = rows
      .map((row) =>
        row
          .map((value) => {
            const text = value ?? '';
            const escaped = text.replace(/"/g, '""');
            return /["\n,]/.test(escaped) ? `"${escaped}"` : escaped;
          })
          .join(','),
      )
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `listings-export-${timestamp}.csv`;

    if (!document.body) {
      window.URL.revokeObjectURL(url);
      return;
    }

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 0);
  }, [columnDefinitionMap, columnOrder, filteredListings, hiddenColumns]);

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
        <div className="listing-table__scroll-indicator-container">
          <div className="listing-table__export-controls">
            <div className="listing-table__export-actions">
              <button
                type="button"
                className="listing-table__export-button"
                onClick={handleExportCsv}
                disabled={filteredListingsCount === 0}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="listing-table__columns-button"
                onClick={() => setIsColumnPanelOpen((open) => !open)}
                aria-expanded={isColumnPanelOpen}
                aria-controls="listing-table-columns-panel"
              >
                Columns
                <span aria-hidden="true">{isColumnPanelOpen ? '▴' : '▾'}</span>
              </button>
            </div>
            {isColumnPanelOpen ? (
              <div
                ref={columnPanelRef}
                className="listing-table__column-panel"
                id="listing-table-columns-panel"
                role="dialog"
                aria-label="Select listing table columns"
              >
                <p className="listing-table__column-panel-description">
                  Drag to reorder columns. Uncheck to hide and move a column to the bottom of the list.
                </p>
                <ul ref={columnPanelListRef} className="listing-table__column-panel-list">
                  {panelColumnDefinitions.map((definition) => {
                    const isHidden = hiddenColumns.includes(definition.key);
                    const isDropTarget = columnPanelDragTarget === definition.key;
                    const isCheckboxDisabled = !isHidden && visibleColumnsCount <= 1;
                    return (
                      <li
                        key={definition.key}
                        className="listing-table__column-panel-item"
                        data-hidden={isHidden}
                        data-drop-target={isDropTarget}
                        data-dragging={columnPanelActiveDragSource === definition.key}
                        onDragOver={handleColumnPanelDragOver(definition.key)}
                        onDrop={handleColumnPanelDrop(definition.key)}
                        onDragLeave={handleColumnPanelDragLeave(definition.key)}
                      >
                        <label className="listing-table__column-panel-label">
                          <input
                            type="checkbox"
                            checked={!isHidden}
                            onChange={(event) =>
                              handleToggleColumnVisibility(definition.key, event.target.checked)
                            }
                            disabled={isCheckboxDisabled}
                          />
                          <span>{definition.label}</span>
                        </label>
                        <button
                          type="button"
                          className="listing-table__column-panel-drag-handle"
                          draggable
                          onDragStart={handleColumnPanelDragStart(definition.key)}
                          onDragEnd={handleColumnPanelDragEnd}
                          aria-label={`Drag to reorder the ${definition.label} column`}
                        >
                          <span aria-hidden="true">⋮⋮</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="listing-table__column-panel-actions">
                  <button
                    type="button"
                    className="listing-table__export-button listing-table__export-button--secondary"
                    onClick={handleExportCsv}
                    disabled={filteredListingsCount === 0}
                  >
                    Download CSV
                  </button>
                </div>
              </div>
            ) : null}
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
              {visibleColumnDefinitions.map((definition) => {
                const filterValue = columnFilters[definition.key] ?? '';
                const isBooleanFilter = definition.filterType === 'boolean';
                const selectValue = filterValue === '' ? 'all' : filterValue;

                return (
                  <th key={`${definition.key}-filter`}>
                    <label className="listing-table__filter">
                      <span className="visually-hidden">Filter {definition.label}</span>
                      {isBooleanFilter ? (
                        <select
                          value={selectValue}
                          onChange={handleFilterChange(definition.key, {
                            normalize: (value) => (value === 'all' ? '' : value),
                          })}
                          className="listing-table__filter-select"
                          aria-label={`Filter ${definition.label}`}
                        >
                          <option value="all">All</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={filterValue}
                          onChange={handleFilterChange(definition.key)}
                          placeholder="Type to filter…"
                          className="listing-table__filter-input"
                        />
                      )}
                    </label>
                  </th>
                );
              })}
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
                          <svg
                            className="listing-table__detail-icon"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                            <circle cx="12" cy="8" r="1" fill="currentColor" />
                            <path d="M11.25 10.5c0-.414.336-.75.75-.75s.75.336.75.75v5.25a.75.75 0 0 1-1.5 0Z" fill="currentColor" />
                          </svg>
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
      </div>

      <nav className="listing-table__pagination" aria-label="Listing pagination">
        <form className="listing-table__page-size-form" onSubmit={handlePageSizeSubmit}>
          <label htmlFor={pageSizeInputId}>Rows per page</label>
          <input
            id={pageSizeInputId}
            type="number"
            min={1}
            max={MAX_PAGE_SIZE}
            inputMode="numeric"
            pattern="[0-9]*"
            value={pageSizeInputValue}
            onChange={handlePageSizeInputChange}
            onBlur={handlePageSizeBlur}
            className="listing-table__page-size-input"
            aria-describedby={`${pageSizeInputId}-hint`}
          />
          <span id={`${pageSizeInputId}-hint`} className="listing-table__page-size-hint">
            Max {MAX_PAGE_SIZE.toLocaleString()}
          </span>
        </form>
        <div className="listing-table__page-controls">
          <button type="button" onClick={() => handlePageChange(1)} disabled={safePage === 1}>
            « First
          </button>
          <button type="button" onClick={() => handlePageChange(safePage - 1)} disabled={safePage === 1}>
            ‹ Prev
          </button>
          <div className="listing-table__page-jump" ref={pageJumpContainerRef}>
            <button
              type="button"
              className="listing-table__page-jump-button"
              onClick={handlePageJumpToggle}
              aria-haspopup="dialog"
              aria-expanded={isPageJumpOpen}
            >
              Page {safePage} of {totalPages}
            </button>
            {isPageJumpOpen ? (
              <form className="listing-table__page-jump-popover" onSubmit={handlePageJumpSubmit}>
                <label className="listing-table__sr-only" htmlFor={pageJumpInputId}>
                  Go to page
                </label>
                <input
                  id={pageJumpInputId}
                  ref={pageJumpInputRef}
                  className="listing-table__page-jump-input"
                  type="number"
                  value={pageJumpValue}
                  onChange={handlePageJumpInputChange}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={1}
                  max={totalPages}
                  aria-describedby={`${pageJumpInputId}-hint`}
                />
                <span id={`${pageJumpInputId}-hint`} className="listing-table__page-jump-hint">
                  Press Enter to jump
                </span>
              </form>
            ) : null}
          </div>
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
        </div>
      </nav>
    </section>
  );
}

export default ListingTable;
