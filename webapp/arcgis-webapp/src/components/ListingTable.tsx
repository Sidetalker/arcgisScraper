import './ListingTable.css';

import {
  Fragment,
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
import { Link, useLocation } from 'react-router-dom';

import {
  type ListingTableColumnFilters,
  type ListingTableColumnKey,
  type ListingTableSort,
} from '@/constants/listingTable';
import {
  filterListingsByColumnFilters,
  normalizeText,
  toUniqueOwners,
} from '@/utils/listingColumnFilters';
import type { ListingCustomizationOverrides } from '@/services/listingStorage';
import type {
  ListingRecord,
  ListingSourceOfTruth,
  StrLicenseStatus,
} from '@/types';
import ListingComments from '@/components/ListingComments';
import { fetchListingCommentCounts } from '@/services/listingComments';

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
  sort: ListingTableSort | null;
  onColumnOrderChange: (order: ListingTableColumnKey[]) => void;
  onHiddenColumnsChange: (hidden: ListingTableColumnKey[]) => void;
  onColumnFiltersChange: (filters: ListingTableColumnFilters) => void;
  onSortChange: (sort: ListingTableSort | null) => void;
  onFavoriteChange: (listingId: string, isFavorited: boolean) => Promise<void> | void;
  canToggleFavorites: boolean;
  favoriteDisabledReason?: string;
  onListingEdit: (
    listingId: string,
    overrides: ListingCustomizationOverrides,
  ) => Promise<void> | void;
  onListingRevert: (listingId: string) => Promise<void> | void;
  canEditListings: boolean;
  editDisabledReason?: string;
  selectionMode?: 'favorites' | 'watchlist';
  selectedListingIds?: Set<string> | string[];
  onSelectionChange?: (listingId: string, isSelected: boolean) => Promise<void> | void;
  canChangeSelection?: boolean;
  selectionDisabledReason?: string;
  selectionLabel?: string;
  commentLinkPath?: string;
}

type ColumnKey = ListingTableColumnKey;

type SourcePreviewValue = string | string[] | null | undefined;

const STR_LICENSE_STATUS_LABELS: Record<StrLicenseStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  expired: 'Expired',
  inactive: 'Inactive',
  revoked: 'Revoked',
  unknown: 'Unknown',
};

function formatSourcePreview(value: SourcePreviewValue): string | null {
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .join('\n');
    return joined.length > 0 ? joined : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function formatStrLicenseStatus(listing: ListingRecord): string {
  const rawStatus = typeof listing.strLicenseStatus === 'string'
    ? listing.strLicenseStatus.trim()
    : '';
  if (rawStatus.length > 0) {
    return rawStatus;
  }

  const normalized = listing.strLicenseStatusNormalized ?? 'unknown';
  return STR_LICENSE_STATUS_LABELS[normalized] ?? STR_LICENSE_STATUS_LABELS.unknown;
}

function getSourceOfTruthText(listing: ListingRecord, columnKey: ColumnKey): string | null {
  const source: ListingSourceOfTruth = listing.sourceOfTruth ?? {
    complex: listing.complex,
    unit: listing.unit,
    unitNormalized: listing.unitNormalized,
    ownerName: listing.ownerName,
    ownerNames: [...listing.ownerNames],
    mailingAddress: listing.mailingAddress,
    mailingAddressLine1: listing.mailingAddressLine1,
    mailingAddressLine2: listing.mailingAddressLine2,
    mailingCity: listing.mailingCity,
    mailingState: listing.mailingState,
    mailingZip5: listing.mailingZip5,
    mailingZip9: listing.mailingZip9,
    subdivision: listing.subdivision,
    scheduleNumber: listing.scheduleNumber,
    physicalAddress: listing.physicalAddress,
    isBusinessOwner: listing.isBusinessOwner,
  };

  switch (columnKey) {
    case 'complex':
      return formatSourcePreview(source.complex);
    case 'unit':
      return formatSourcePreview(source.unit);
    case 'owners':
      return source.ownerNames.length > 0
        ? formatSourcePreview(source.ownerNames)
        : formatSourcePreview(source.ownerName);
    case 'business':
      return source.isBusinessOwner ? 'Yes' : 'No';
    case 'mailingAddress':
      return formatSourcePreview(
        streetAddressFromSegments(source.mailingAddressLine1, source.mailingAddressLine2),
      );
    case 'mailingCity':
      return formatSourcePreview(source.mailingCity);
    case 'mailingState':
      return formatSourcePreview(source.mailingState);
    case 'mailingZip':
      return formatSourcePreview(source.mailingZip9 || source.mailingZip5);
    case 'subdivision':
      return formatSourcePreview(source.subdivision);
    case 'scheduleNumber':
      return formatSourcePreview(source.scheduleNumber);
    case 'physicalAddress':
      return formatSourcePreview(source.physicalAddress);
    default:
      return null;
  }
}

interface ColumnDefinition {
  key: ColumnKey;
  label: string;
  render: (listing: ListingRecord) => ReactNode;
  getFilterValue: (listing: ListingRecord) => string;
  getExportValue: (listing: ListingRecord) => string;
  getSortValue: (listing: ListingRecord) => string;
  filterType?: 'text' | 'boolean';
}

interface ListingEditDraft {
  complex: string;
  unit: string;
  ownerNames: string;
  isBusinessOwner: 'yes' | 'no';
  mailingAddress: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  subdivision: string;
  scheduleNumber: string;
  physicalAddress: string;
}

function formatCityStateZipLine(city: string, state: string, zip: string): string {
  const cityPart = city.trim();
  const statePart = state.trim();
  const zipPart = zip.trim();

  let line = '';
  if (cityPart && statePart) {
    line = `${cityPart}, ${statePart}`;
  } else if (cityPart) {
    line = cityPart;
  } else if (statePart) {
    line = statePart;
  }

  if (line && zipPart) {
    return `${line} ${zipPart}`.trim();
  }

  if (!line && zipPart) {
    return zipPart;
  }

  return line;
}

function composeMailingAddressText(
  line1: string,
  line2: string,
  city: string,
  state: string,
  zip: string,
): string {
  const lines: string[] = [];
  const trimmedLine1 = line1.trim();
  const trimmedLine2 = line2.trim();

  if (trimmedLine1) {
    lines.push(trimmedLine1);
  }

  if (trimmedLine2) {
    trimmedLine2
      .split(/\r?\n/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => {
        lines.push(segment);
      });
  }

  const cityLine = formatCityStateZipLine(city, state, zip);
  if (cityLine) {
    lines.push(cityLine);
  }

  return lines.join('\n');
}

function streetAddressFromSegments(line1: string, line2: string): string {
  const parts: string[] = [];
  if (line1.trim()) {
    parts.push(line1.trim());
  }
  if (line2.trim()) {
    line2
      .split(/\r?\n/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => {
        parts.push(segment);
      });
  }
  return parts.join('\n');
}

function streetAddressFromListing(listing: ListingRecord): string {
  return streetAddressFromSegments(listing.mailingAddressLine1, listing.mailingAddressLine2);
}

function parseOwnerNamesInput(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function normaliseZipParts(input: string): { zip5: string; zip9: string } {
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length >= 9) {
    const zip5 = digits.slice(0, 5);
    const plus4 = digits.slice(5, 9);
    return { zip5, zip9: `${zip5}-${plus4}` };
  }

  if (digits.length >= 5) {
    const zip5 = digits.slice(0, 5);
    return { zip5, zip9: '' };
  }

  return { zip5: digits, zip9: '' };
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
    getSortValue: (listing) => normalizeText(listing.complex),
  },
  {
    key: 'unit',
    label: 'Unit',
    render: (listing) => listing.unit || '—',
    getFilterValue: (listing) => normalizeText(listing.unit),
    getExportValue: (listing) => normalizeText(listing.unit),
    getSortValue: (listing) => normalizeText(listing.unit),
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
          {listing.isOwnerBlacklisted ? (
            <span className="listing-table__owner-badge" aria-label="Owner is blacklisted">
              Blacklisted
            </span>
          ) : null}
          {owners.length > 1 ? (
            <div className="listing-table__owner-count">{owners.length} owners</div>
          ) : null}
        </div>
      );
    },
    getFilterValue: (listing) => normalizeText(listing.ownerNames.join(' ')),
    getExportValue: (listing) => toUniqueOwners(listing).join('; '),
    getSortValue: (listing) => normalizeText(toUniqueOwners(listing).join(' ')),
  },
  {
    key: 'business',
    label: 'Business-owned',
    render: (listing) => (listing.isBusinessOwner ? 'Yes' : 'No'),
    getFilterValue: (listing) => (listing.isBusinessOwner ? 'yes' : 'no'),
    getExportValue: (listing) => (listing.isBusinessOwner ? 'Yes' : 'No'),
    getSortValue: (listing) => (listing.isBusinessOwner ? 'yes' : 'no'),
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
    getSortValue: (listing) => normalizeText(listing.mailingAddress),
  },
  {
    key: 'mailingCity',
    label: 'Mailing city',
    render: (listing) => listing.mailingCity || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingCity),
    getExportValue: (listing) => normalizeText(listing.mailingCity),
    getSortValue: (listing) => normalizeText(listing.mailingCity),
  },
  {
    key: 'mailingState',
    label: 'State',
    render: (listing) => listing.mailingState || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingState),
    getExportValue: (listing) => normalizeText(listing.mailingState),
    getSortValue: (listing) => normalizeText(listing.mailingState),
  },
  {
    key: 'mailingZip',
    label: 'ZIP',
    render: (listing) => listing.mailingZip9 || listing.mailingZip5 || '—',
    getFilterValue: (listing) => normalizeText(listing.mailingZip9 || listing.mailingZip5),
    getExportValue: (listing) =>
      normalizeText(listing.mailingZip9 || listing.mailingZip5 || ''),
    getSortValue: (listing) => normalizeText(listing.mailingZip9 || listing.mailingZip5),
  },
  {
    key: 'subdivision',
    label: 'Subdivision',
    render: (listing) => listing.subdivision || '—',
    getFilterValue: (listing) => normalizeText(listing.subdivision),
    getExportValue: (listing) => normalizeText(listing.subdivision),
    getSortValue: (listing) => normalizeText(listing.subdivision),
  },
  {
    key: 'scheduleNumber',
    label: 'Schedule #',
    render: (listing) => listing.scheduleNumber || '—',
    getFilterValue: (listing) => normalizeText(listing.scheduleNumber),
    getExportValue: (listing) => normalizeText(listing.scheduleNumber),
    getSortValue: (listing) => normalizeText(listing.scheduleNumber),
  },
  {
    key: 'strLicenseId',
    label: 'STR license ID',
    render: (listing) => listing.strLicenseId || '—',
    getFilterValue: (listing) => normalizeText(listing.strLicenseId),
    getExportValue: (listing) => normalizeText(listing.strLicenseId),
    getSortValue: (listing) => normalizeText(listing.strLicenseId),
  },
  {
    key: 'strLicenseStatus',
    label: 'STR license status',
    render: (listing) => formatStrLicenseStatus(listing),
    getFilterValue: (listing) => listing.strLicenseStatusNormalized,
    getExportValue: (listing) => formatStrLicenseStatus(listing),
    getSortValue: (listing) => listing.strLicenseStatusNormalized,
  },
  {
    key: 'physicalAddress',
    label: 'Physical address',
    render: (listing) => listing.physicalAddress || '—',
    getFilterValue: (listing) => normalizeText(listing.physicalAddress),
    getExportValue: (listing) => normalizeText(listing.physicalAddress),
    getSortValue: (listing) => normalizeText(listing.physicalAddress),
  },
  {
    key: 'waitlist',
    label: 'Waitlist',
    render: (listing) => {
      if (!listing.waitlistType) {
        return '—';
      }
      const label = listing.waitlistType === 'upper_blue_basin' ? 'Upper Blue' : 'Lower Blue';
      return listing.waitlistPosition
        ? `${label} #${listing.waitlistPosition}`
        : label;
    },
    getFilterValue: (listing) => (listing.waitlistType ? 'yes' : 'no'),
    getExportValue: (listing) => {
      if (!listing.waitlistType) {
        return '';
      }
      const label = listing.waitlistType === 'upper_blue_basin' ? 'Upper Blue' : 'Lower Blue';
      return listing.waitlistPosition
        ? `${label} #${listing.waitlistPosition}`
        : label;
    },
    getSortValue: (listing) => {
      if (!listing.waitlistType) {
        return 'zzzz';
      }
      return `${listing.waitlistType}-${listing.waitlistPosition?.toString().padStart(5, '0') ?? ''}`;
    },
    filterType: 'boolean',
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
  sort,
  onColumnOrderChange,
  onHiddenColumnsChange,
  onColumnFiltersChange,
  onSortChange,
  onFavoriteChange,
  canToggleFavorites,
  favoriteDisabledReason,
  onListingEdit,
  onListingRevert,
  canEditListings,
  editDisabledReason,
  selectionMode,
  selectedListingIds,
  onSelectionChange,
  canChangeSelection,
  selectionDisabledReason,
  selectionLabel,
  commentLinkPath,
}: ListingTableProps) {
  const [dragTarget, setDragTarget] = useState<ColumnKey | null>(null);
  const dragSource = useRef<ColumnKey | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    const setCommentViewportWidth = () => {
      element.style.setProperty(
        '--listing-table-comment-viewport-width',
        `${element.clientWidth}px`,
      );
    };

    setCommentViewportWidth();

    let resizeObserver: ResizeObserver | null = null;

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        setCommentViewportWidth();
      });
      resizeObserver.observe(element);
    }

    window.addEventListener('resize', setCommentViewportWidth);

    return () => {
      window.removeEventListener('resize', setCommentViewportWidth);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);
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
  const [pendingSelectionIds, setPendingSelectionIds] = useState<Set<string>>(() => new Set());
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ListingEditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingRevertIds, setPendingRevertIds] = useState<Set<string>>(() => new Set());
  const [expandedCommentListingIds, setExpandedCommentListingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [listingCommentCounts, setListingCommentCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const location = useLocation();
  const commentLinkBasePath = commentLinkPath ?? location.pathname;
  const [pendingCommentTarget, setPendingCommentTarget] = useState<
    { listingId: string; commentId: string } | null
  >(null);
  const [commentHighlightTarget, setCommentHighlightTarget] = useState<
    { listingId: string; commentId: string } | null
  >(null);
  const pendingCommentPageRef = useRef<number | null>(null);
  const favoriteDisabledMessage =
    favoriteDisabledReason ?? 'Supabase is not configured. Favorites are read-only.';
  const watchlistDisabledMessage =
    selectionDisabledReason ?? 'Supabase is not configured. Watchlists are read-only.';
  const effectiveSelectionMode = selectionMode ?? 'favorites';
  const canToggleSelection =
    effectiveSelectionMode === 'watchlist'
      ? canChangeSelection ?? true
      : canToggleFavorites;
  const selectionDisabledMessage =
    effectiveSelectionMode === 'watchlist' ? watchlistDisabledMessage : favoriteDisabledMessage;
  const selectedListingSet = useMemo(() => {
    if (!selectedListingIds) {
      return new Set<string>();
    }
    if (selectedListingIds instanceof Set) {
      return selectedListingIds;
    }
    return new Set<string>(selectedListingIds);
  }, [selectedListingIds]);

  const urlCommentTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const listingParam = params.get('listing');
    const commentParam = params.get('comment');
    if (!listingParam || !commentParam) {
      return null;
    }
    return { listingId: listingParam, commentId: commentParam } as const;
  }, [location.search]);

  useEffect(() => {
    setPendingCommentTarget(urlCommentTarget);
    if (!urlCommentTarget) {
      setCommentHighlightTarget(null);
    }
  }, [urlCommentTarget]);
  useEffect(() => {
    setExpandedCommentListingIds((current) => {
      if (current.size === 0) {
        return current;
      }
      const validIds = new Set(listings.map((listing) => listing.id));
      let changed = false;
      current.forEach((id) => {
        if (!validIds.has(id)) {
          changed = true;
        }
      });
      if (!changed) {
        return current;
      }
      const next = new Set<string>();
      current.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [listings]);
  const createDraftFromListing = useCallback((listing: ListingRecord): ListingEditDraft => {
    return {
      complex: listing.complex,
      unit: listing.unit,
      ownerNames: listing.ownerNames.length ? listing.ownerNames.join('\n') : listing.ownerName,
      isBusinessOwner: listing.isBusinessOwner ? 'yes' : 'no',
      mailingAddress: streetAddressFromListing(listing),
      mailingCity: listing.mailingCity,
      mailingState: listing.mailingState,
      mailingZip: listing.mailingZip9 || listing.mailingZip5,
      subdivision: listing.subdivision,
      scheduleNumber: listing.scheduleNumber,
      physicalAddress: listing.physicalAddress,
    };
  }, []);
  const handleCancelEdit = useCallback(() => {
    setEditingListingId(null);
    setEditDraft(null);
    setEditError(null);
    setSavingEdit(false);
  }, []);
  const handleStartEdit = useCallback(
    (listing: ListingRecord) => {
      if (!canEditListings) {
        return;
      }

      if (editingListingId && editingListingId !== listing.id && typeof window !== 'undefined') {
        const confirmed = window.confirm('Discard your current edits?');
        if (!confirmed) {
          return;
        }
      }

      setEditingListingId(listing.id);
      setEditDraft(createDraftFromListing(listing));
      setEditError(null);
      setSavingEdit(false);
    },
    [canEditListings, createDraftFromListing, editingListingId],
  );
  const handleToggleComments = useCallback((listingId: string) => {
    setExpandedCommentListingIds((current) => {
      const next = new Set(current);
      if (next.has(listingId)) {
        next.delete(listingId);
      } else {
        next.add(listingId);
      }
      return next;
    });
  }, []);
  const handleDraftInputChange = useCallback(
    (field: keyof ListingEditDraft) =>
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const rawValue = event.target.value;
        const value =
          field === 'mailingState'
            ? rawValue.toUpperCase().slice(0, 2)
            : rawValue;
        setEditDraft((current) => (current ? { ...current, [field]: value } : current));
      },
    [],
  );
  const handleBusinessOwnerChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value === 'yes' ? 'yes' : 'no';
      setEditDraft((current) => (current ? { ...current, isBusinessOwner: value } : current));
    },
    [],
  );
  const buildOverridesFromDraft = useCallback(
    (draft: ListingEditDraft): ListingCustomizationOverrides => {
      const ownerNames = parseOwnerNamesInput(draft.ownerNames);
      const ownerName = ownerNames.join('; ');
      const { zip5, zip9 } = normaliseZipParts(draft.mailingZip);
      const state = draft.mailingState.trim().toUpperCase();
      const streetLines = draft.mailingAddress
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const line1 = streetLines[0] ?? '';
      const line2 = streetLines.length > 1 ? streetLines.slice(1).join('\n') : '';
      const city = draft.mailingCity.trim();
      const mailingAddress = composeMailingAddressText(line1, line2, city, state, zip9 || zip5);

      return {
        complex: draft.complex.trim(),
        unit: draft.unit.trim(),
        ownerName,
        ownerNames,
        isBusinessOwner: draft.isBusinessOwner === 'yes',
        mailingAddress,
        mailingAddressLine1: line1,
        mailingAddressLine2: line2,
        mailingCity: city,
        mailingState: state,
        mailingZip5: zip5,
        mailingZip9: zip9,
        subdivision: draft.subdivision.trim(),
        scheduleNumber: draft.scheduleNumber.trim(),
        physicalAddress: draft.physicalAddress.trim(),
      };
    },
    [],
  );
  const handleSaveEdit = useCallback(async () => {
    if (!editingListingId || !editDraft) {
      return;
    }

    if (!canEditListings) {
      return;
    }

    const targetListing = listings.find((listing) => listing.id === editingListingId);
    if (!targetListing) {
      setEditError('Listing not found.');
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      const overrides = buildOverridesFromDraft(editDraft);
      const result = onListingEdit(editingListingId, overrides);
      await Promise.resolve(result);
      handleCancelEdit();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save listing changes.';
      setEditError(message);
    } finally {
      setSavingEdit(false);
    }
  }, [
    buildOverridesFromDraft,
    canEditListings,
    editDraft,
    editingListingId,
    handleCancelEdit,
    listings,
    onListingEdit,
  ]);
  const handleRevertListing = useCallback(
    (listing: ListingRecord) =>
      async () => {
        if (!canEditListings) {
          return;
        }

        if (typeof window !== 'undefined') {
          const confirmed = window.confirm(
            'Revert to the original listing data? This will discard your customizations.',
          );
          if (!confirmed) {
            return;
          }
        }

        setPendingRevertIds((current) => {
          const next = new Set(current);
          next.add(listing.id);
          return next;
        });
        setEditError(null);

        try {
          const result = onListingRevert(listing.id);
          await Promise.resolve(result);
          if (editingListingId === listing.id) {
            handleCancelEdit();
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to revert listing data.';
          if (editingListingId === listing.id) {
            setEditError(message);
          } else if (typeof window !== 'undefined') {
            window.alert(message);
          }
        } finally {
          setPendingRevertIds((current) => {
            const next = new Set(current);
            next.delete(listing.id);
            return next;
          });
        }
      },
    [canEditListings, editingListingId, handleCancelEdit, onListingRevert],
  );

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
  const collator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
    [],
  );
  const renderEditableCell = (
    columnKey: ColumnKey,
    listing: ListingRecord,
  ): ReactNode => {
    if (!editDraft) {
      const definition = columnDefinitionMap.get(columnKey);
      return definition ? definition.render(listing) : null;
    }

    const originalText = getSourceOfTruthText(listing, columnKey);
    const wrapWithSource = (control: ReactNode): ReactNode => (
      <div className="listing-table__edit-control">
        {control}
        <p className="listing-table__edit-source">
          <span className="listing-table__edit-source-label">Original:</span>
          <span className="listing-table__edit-source-value">{originalText ?? '—'}</span>
        </p>
      </div>
    );

    switch (columnKey) {
      case 'complex':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.complex}
            onChange={handleDraftInputChange('complex')}
            className="listing-table__edit-input"
          />,
        );
      case 'unit':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.unit}
            onChange={handleDraftInputChange('unit')}
            className="listing-table__edit-input"
          />,
        );
      case 'owners':
        return wrapWithSource(
          <textarea
            value={editDraft.ownerNames}
            onChange={handleDraftInputChange('ownerNames')}
            className="listing-table__edit-textarea"
            rows={Math.max(2, editDraft.ownerNames.split(/\r?\n/).length || 2)}
            placeholder="One owner per line"
          />,
        );
      case 'business':
        return wrapWithSource(
          <select
            value={editDraft.isBusinessOwner}
            onChange={handleBusinessOwnerChange}
            className="listing-table__edit-select"
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>,
        );
      case 'mailingAddress':
        return wrapWithSource(
          <textarea
            value={editDraft.mailingAddress}
            onChange={handleDraftInputChange('mailingAddress')}
            className="listing-table__edit-textarea"
            rows={Math.max(2, editDraft.mailingAddress.split(/\r?\n/).length || 2)}
            placeholder="Street address (one line per entry)"
          />,
        );
      case 'mailingCity':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.mailingCity}
            onChange={handleDraftInputChange('mailingCity')}
            className="listing-table__edit-input"
          />,
        );
      case 'mailingState':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.mailingState}
            onChange={handleDraftInputChange('mailingState')}
            className="listing-table__edit-input listing-table__edit-input--state"
            maxLength={2}
          />,
        );
      case 'mailingZip':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.mailingZip}
            onChange={handleDraftInputChange('mailingZip')}
            className="listing-table__edit-input"
            inputMode="numeric"
            pattern="[0-9-]*"
            placeholder="ZIP or ZIP+4"
          />,
        );
      case 'subdivision':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.subdivision}
            onChange={handleDraftInputChange('subdivision')}
            className="listing-table__edit-input"
          />,
        );
      case 'scheduleNumber':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.scheduleNumber}
            onChange={handleDraftInputChange('scheduleNumber')}
            className="listing-table__edit-input"
          />,
        );
      case 'physicalAddress':
        return wrapWithSource(
          <input
            type="text"
            value={editDraft.physicalAddress}
            onChange={handleDraftInputChange('physicalAddress')}
            className="listing-table__edit-input"
          />,
        );
      default: {
        const definition = columnDefinitionMap.get(columnKey);
        return definition ? definition.render(listing) : null;
      }
    }
  };

  const visibleColumns = useMemo(
    () => columnOrder.filter((key) => !hiddenColumns.includes(key)),
    [columnOrder, hiddenColumns],
  );

  const hasActiveColumnFilters = useMemo(
    () => Object.values(columnFilters).some((value) => value.trim().length > 0),
    [columnFilters],
  );

  const filteredListings = useMemo(() => {
    return filterListingsByColumnFilters(listings, columnFilters);
  }, [columnFilters, listings]);

  const sortedListings = useMemo(() => {
    if (!sort) {
      return filteredListings;
    }

    const definition = columnDefinitionMap.get(sort.columnKey);
    if (!definition) {
      return filteredListings;
    }

    const sortable = [...filteredListings];
    sortable.sort((a, b) => {
      const valueA = definition.getSortValue(a);
      const valueB = definition.getSortValue(b);
      const comparison = collator.compare(valueA, valueB);
      return sort.direction === 'desc' ? -comparison : comparison;
    });

    return sortable;
  }, [collator, columnDefinitionMap, filteredListings, sort]);

  const fallbackPageSize = sortedListings.length > 0 ? sortedListings.length : 1;
  const resolvedPageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : fallbackPageSize;
  const effectivePageSize = Math.min(Math.max(resolvedPageSize, 1), MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sortedListings.length / effectivePageSize) || 1);
  const clampPage = (value: number) => Math.min(Math.max(value, 1), totalPages);
  const requestedPage = Number.isFinite(currentPage) ? Math.floor(currentPage) : 1;
  const safePage = clampPage(requestedPage);
  const startIndex = (safePage - 1) * effectivePageSize;
  // Use the sortedListings for pagination so user-visible order reflects active sorting.
  const endIndex = Math.min(startIndex + effectivePageSize, sortedListings.length);
  const pageListings = useMemo(
    () => sortedListings.slice(startIndex, endIndex),
    [sortedListings, startIndex, endIndex],
  );
  const columnCount = Math.max(1, visibleColumns.length + 2);
  const pageListingIds = useMemo(
    () => pageListings.map((listing) => listing.id),
    [pageListings],
  );

  useEffect(() => {
    if (pageListingIds.length === 0) {
      return;
    }

    let active = true;

    const load = async () => {
      try {
        const counts = await fetchListingCommentCounts(pageListingIds);
        if (!active) {
          return;
        }

        setListingCommentCounts((current) => {
          const next = new Map(current);
          pageListingIds.forEach((id) => next.delete(id));
          for (const [listingId, count] of Object.entries(counts)) {
            if (count > 0) {
              next.set(listingId, count);
            }
          }
          return next;
        });
      } catch (error) {
        console.error('Failed to load comment counts for visible listings.', error);
        setListingCommentCounts((current) => {
          if (current.size === 0) {
            return current;
          }
          const next = new Map(current);
          pageListingIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [pageListingIds]);

  const handleSelectionToggle = useCallback(
    (listingId: string) => (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.checked;
      setPendingSelectionIds((previous) => {
        const next = new Set(previous);
        next.add(listingId);
        return next;
      });

      const settle = () => {
        setPendingSelectionIds((previous) => {
          const next = new Set(previous);
          next.delete(listingId);
          return next;
        });
      };

      const handler =
        effectiveSelectionMode === 'watchlist' && onSelectionChange
          ? onSelectionChange
          : onFavoriteChange;

      try {
        const result = handler(listingId, nextValue);
        void Promise.resolve(result)
          .catch((error) => {
            console.error('Failed to update selection state.', error);
          })
          .finally(settle);
      } catch (error) {
        console.error('Failed to update selection state.', error);
        settle();
      }
    },
    [effectiveSelectionMode, onFavoriteChange, onSelectionChange],
  );

  const handleListingCommentSummary = useCallback(
    (summary: { listingId: string; count: number; hasComments: boolean }) => {
      setListingCommentCounts((current) => {
        const next = new Map(current);
        if (summary.count > 0) {
          next.set(summary.listingId, summary.count);
        } else {
          next.delete(summary.listingId);
        }
        return next;
      });
    },
    [],
  );

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
  }, [handleScroll, updateScrollIndicators, visibleColumns.length, sortedListings.length, stopAutoScroll]);

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

    const handleClose = () => {
      setIsPageJumpOpen(false);
      setPageJumpValue('');
    };

    const handleClick = (event: MouseEvent) => {
      if (pageJumpContainerRef.current?.contains(event.target as Node)) {
        return;
      }
      handleClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPageJumpOpen]);

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

  const handleSortToggle = useCallback(
    (columnKey: ColumnKey) => {
      const isActive = sort?.columnKey === columnKey;
      let nextSort: ListingTableSort | null;

      if (!isActive) {
        nextSort = { columnKey, direction: 'asc' };
      } else if (sort?.direction === 'asc') {
        nextSort = { columnKey, direction: 'desc' };
      } else if (sort?.direction === 'desc') {
        nextSort = null;
      } else {
        nextSort = { columnKey, direction: 'asc' };
      }

      onSortChange(nextSort);
      onPageChange(1);
    },
    [onPageChange, onSortChange, sort],
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
    if (!pendingCommentTarget) {
      pendingCommentPageRef.current = null;
      return;
    }

    const { listingId, commentId } = pendingCommentTarget;
  // Determine page based on sortedListings so deep-link comment navigation aligns with displayed order.
  const filteredIndex = sortedListings.findIndex((listing) => listing.id === listingId);
    if (filteredIndex === -1) {
      setCommentHighlightTarget((current) => {
        if (current && current.listingId === listingId) {
          return null;
        }
        return current;
      });
      return;
    }

    const targetPage = Math.floor(filteredIndex / effectivePageSize) + 1;
    if (targetPage !== safePage) {
      if (pendingCommentPageRef.current !== targetPage) {
        pendingCommentPageRef.current = targetPage;
        onPageChange(targetPage);
      }
      return;
    }

    pendingCommentPageRef.current = null;

    setExpandedCommentListingIds((current) => {
      if (current.has(listingId)) {
        return current;
      }
      const next = new Set(current);
      next.add(listingId);
      return next;
    });

    setCommentHighlightTarget((current) => {
      if (current && current.listingId === listingId && current.commentId === commentId) {
        return current;
      }
      return { listingId, commentId };
    });

    const clearPendingCommentTarget = () => {
      setPendingCommentTarget((current) => {
        if (!current) {
          return current;
        }

        if (current.listingId !== listingId || current.commentId !== commentId) {
          return current;
        }

        return null;
      });
    };

    const row = rowRefs.current.get(listingId);
    if (row && typeof row.scrollIntoView === 'function') {
      if (
        typeof window !== 'undefined' &&
        typeof window.requestAnimationFrame === 'function'
      ) {
        window.requestAnimationFrame(() => {
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          clearPendingCommentTarget();
        });
      } else {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        clearPendingCommentTarget();
      }
    } else {
      clearPendingCommentTarget();
    }
  }, [pendingCommentTarget, filteredListings, effectivePageSize, safePage, onPageChange]);

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
  const displayedListingsCount = sortedListings.length;
  const summaryText = isLoading
    ? 'Loading listings from ArcGIS…'
    : `Showing ${displayedListingsCount.toLocaleString()} matching listings${
        displayedListingsCount !== totalListingsCount
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
      ...sortedListings.map((listing) =>
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
  }, [columnDefinitionMap, columnOrder, hiddenColumns, sortedListings]);

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
            {displayedListingsCount > 0
              ? `Displaying ${startIndex + 1}-${endIndex} of ${displayedListingsCount.toLocaleString()}`
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
                disabled={displayedListingsCount === 0}
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
                    disabled={displayedListingsCount === 0}
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
                <th scope="col" className="listing-table__favorite-header">
                  <span className="visually-hidden">Favorite</span>
                </th>
                <th scope="col" className="listing-table__details-header">
                  <span className="visually-hidden">Listing details</span>
                </th>
                {visibleColumnDefinitions.map((definition) => {
                  const isSorted = sort?.columnKey === definition.key;
                  const sortDirection = isSorted ? sort?.direction ?? 'asc' : null;
                  const ariaSort: 'ascending' | 'descending' | 'none' = isSorted
                    ? sortDirection === 'desc'
                      ? 'descending'
                      : 'ascending'
                    : 'none';

                  return (
                    <th
                      key={definition.key}
                      scope="col"
                      onDragOver={handleDragOver(definition.key)}
                      onDrop={handleDrop(definition.key)}
                      onDragLeave={handleDragLeave(definition.key)}
                      data-drop-target={dragTarget === definition.key}
                      data-sorted={isSorted}
                      data-sort-direction={isSorted ? sortDirection : undefined}
                      aria-sort={ariaSort}
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
                        <button
                          type="button"
                          className="listing-table__sort-button"
                          onClick={() => handleSortToggle(definition.key)}
                          data-sorted={isSorted}
                          aria-label={`Sort by ${definition.label}`}
                        >
                          <span className="listing-table__column-title">{definition.label}</span>
                          <span
                            className="listing-table__sort-indicator"
                            data-direction={isSorted ? sortDirection : 'none'}
                            aria-hidden="true"
                          >
                            {isSorted
                              ? sortDirection === 'desc'
                                ? '▼'
                                : '▲'
                              : '↕'}
                          </span>
                        </button>
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
                  );
                })}
              </tr>
            <tr className="listing-table__filters">
              <th aria-hidden="true" />
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
                const isSelectionPending = pendingSelectionIds.has(listing.id);
                const isSelectionDisabled = isSelectionPending || !canToggleSelection;
                const selectionContextLabel =
                  effectiveSelectionMode === 'watchlist'
                    ? selectionLabel ?? 'watchlist membership'
                    : 'favorite';
                const selectionTitle = isSelectionPending
                  ? 'Saving selection…'
                  : isSelectionDisabled
                  ? selectionDisabledMessage
                  : effectiveSelectionMode === 'watchlist'
                  ? `Toggle ${selectionContextLabel}`
                  : 'Toggle favorite for this listing';
                const selectionLabelText = (() => {
                  const listingContext = listing.complex
                    ? `${listing.complex}${listing.unit ? ` unit ${listing.unit}` : ''}`
                    : 'this listing';
                  if (effectiveSelectionMode === 'watchlist') {
                    return `Toggle ${selectionContextLabel} for ${listingContext}`;
                  }
                  return listing.complex
                    ? `Toggle favorite for ${listingContext}`
                    : 'Toggle favorite for this listing';
                })();
                const isSelected =
                  effectiveSelectionMode === 'watchlist'
                    ? selectedListingSet.has(listing.id)
                    : listing.isFavorited;
                const isEditing = editingListingId === listing.id;
                const isRevertPending = pendingRevertIds.has(listing.id);
                const rowClassName = [
                  'listing-table__row',
                  highlightedListingId === listing.id ? 'listing-table__row--highlight' : '',
                  listing.hasCustomizations ? 'listing-table__row--customized' : '',
                  listing.isOwnerBlacklisted ? 'listing-table__row--blacklisted' : '',
                  isEditing ? 'listing-table__row--editing' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                const listingDescriptor =
                  listing.complex || listing.scheduleNumber || listing.id;
                const editButtonTitle = canEditListings
                  ? listing.hasCustomizations
                    ? 'Edit listing details (customized)'
                    : 'Edit listing details'
                  : editDisabledReason ?? 'Editing is disabled';
                const editAriaLabel = listing.hasCustomizations
                  ? `Edit listing ${listingDescriptor} (customized)`
                  : `Edit listing ${listingDescriptor}`;
                const isCommentOpen = expandedCommentListingIds.has(listing.id);
                const commentSectionId = `listing-${listing.id}-comments`;
                const commentToggleLabel = isCommentOpen ? 'Hide comments' : 'Show comments';
                const commentButtonTitle = `${commentToggleLabel} for ${listingDescriptor}`;
                const storedCommentCount = listingCommentCounts.get(listing.id) ?? 0;
                const hasStoredComments = storedCommentCount > 0;

                return (
                  <Fragment key={listing.id}>
                    <tr
                      ref={registerRow(listing.id)}
                      className={rowClassName}
                      data-customized={listing.hasCustomizations ? 'true' : undefined}
                    >
                      <td
                        className="listing-table__favorite-cell"
                        data-loading={isSelectionPending ? 'true' : undefined}
                        aria-busy={isSelectionPending}
                      >
                        <input
                          type="checkbox"
                          className="listing-table__favorite-checkbox"
                          checked={isSelected}
                          onChange={handleSelectionToggle(listing.id)}
                          disabled={isSelectionDisabled}
                          aria-label={selectionLabelText}
                          title={selectionTitle}
                        />
                      </td>
                      <td className="listing-table__detail-cell">
                        <div className="listing-table__detail-actions">
                          <button
                            type="button"
                            className="listing-table__icon-button listing-table__icon-button--edit"
                            onClick={() => handleStartEdit(listing)}
                            disabled={!canEditListings || savingEdit || isRevertPending}
                            title={editButtonTitle}
                            aria-label={editAriaLabel}
                            data-edited={listing.hasCustomizations ? 'true' : undefined}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path
                                d="M4 15.5 15.59 3.91a2 2 0 0 1 2.83 0l1.67 1.67a2 2 0 0 1 0 2.83L8.5 20H4Z"
                                fill="currentColor"
                              />
                              <path d="M3 22h6l12-12-3-3L3 19Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                            <span className="visually-hidden">{editAriaLabel}</span>
                            {listing.hasCustomizations ? (
                              <span className="visually-hidden">Listing has saved customizations</span>
                            ) : null}
                          </button>
                          {listing.publicDetailUrl ? (
                            <a
                              href={listing.publicDetailUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="listing-table__icon-button listing-table__icon-button--detail"
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
                            <span className="listing-table__detail-placeholder" aria-hidden="true">—</span>
                          )}
                          <button
                            type="button"
                            className="listing-table__icon-button listing-table__icon-button--comment"
                            onClick={() => handleToggleComments(listing.id)}
                            title={commentButtonTitle}
                            aria-label={commentButtonTitle}
                            aria-expanded={isCommentOpen}
                            aria-controls={commentSectionId}
                            data-open={isCommentOpen ? 'true' : undefined}
                            data-has-comments={hasStoredComments ? 'true' : undefined}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path
                                d="M4 5.75A2.75 2.75 0 0 1 6.75 3h10.5A2.75 2.75 0 0 1 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H9.56l-3.83 3.09A.75.75 0 0 1 4 18.5Z"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className="visually-hidden">{commentButtonTitle}</span>
                          {hasStoredComments ? (
                            <span className="visually-hidden">Listing has comments</span>
                          ) : null}
                          </button>
                        </div>
                      </td>
                      {visibleColumnDefinitions.map((definition) => (
                        <td
                          key={`${listing.id}-${definition.key}`}
                          className={isEditing ? 'listing-table__cell--editing' : undefined}
                        >
                          {isEditing
                            ? renderEditableCell(definition.key, listing)
                            : definition.render(listing)}
                        </td>
                      ))}
                    </tr>
                    {isEditing ? (
                      <tr className="listing-table__edit-actions-row">
                        <td colSpan={columnCount}>
                          <div className="listing-table__edit-actions">
                            <div className="listing-table__edit-buttons">
                              <button
                                type="button"
                                className="listing-table__edit-primary"
                                onClick={handleSaveEdit}
                                disabled={savingEdit}
                              >
                                {savingEdit ? 'Saving…' : 'Save changes'}
                              </button>
                              <button
                                type="button"
                                className="listing-table__edit-secondary"
                                onClick={handleCancelEdit}
                                disabled={savingEdit}
                              >
                                Cancel (changes will not be saved)
                              </button>
                              {listing.hasCustomizations ? (
                                <button
                                  type="button"
                                  className="listing-table__edit-tertiary"
                                  onClick={handleRevertListing(listing)}
                                  disabled={savingEdit || isRevertPending}
                                >
                                  Revert to original data
                                </button>
                              ) : null}
                            </div>
                            <p className="listing-table__edit-hint">
                              Updates are stored in Supabase so you can revisit them later.
                            </p>
                            {editError ? (
                              <p className="listing-table__edit-error" role="alert">{editError}</p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {isCommentOpen ? (
                      <tr className="listing-table__comment-row">
                        <td colSpan={columnCount} className="listing-table__comment-cell">
                          <div className="listing-table__comment-container">
                            <ListingComments
                              listingId={listing.id}
                              sectionId={commentSectionId}
                              heading={listingDescriptor}
                              sharePath={commentLinkBasePath}
                              highlightCommentId={
                                commentHighlightTarget?.listingId === listing.id
                                  ? commentHighlightTarget.commentId
                                  : null
                              }
                              onCommentSummaryChange={handleListingCommentSummary}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })            )}
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
