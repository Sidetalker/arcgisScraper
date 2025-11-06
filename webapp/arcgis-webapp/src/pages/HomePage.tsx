import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import CollapsibleSection from '@/components/CollapsibleSection';
import FilterPanel from '@/components/FilterPanel';
import ListingTable from '@/components/ListingTable';
import RegionMap from '@/components/RegionMap';
import ConfigurationProfiles from '@/components/ConfigurationProfiles';
import ListingInsights from '@/components/ListingInsights';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE } from '@/constants/listings';
import {
  areTableStatesEqual,
  createDefaultTableState,
  normaliseTableState,
  type ListingTableState,
} from '@/constants/listingTable';
import { useListings } from '@/context/ListingsContext';
import { useWatchlists } from '@/context/WatchlistsContext';
import { applyFilters } from '@/services/listingTransformer';
import {
  fetchConfigurationProfiles,
  saveConfigurationProfile,
} from '@/services/configurationProfiles';
import type { ListingCustomizationOverrides } from '@/services/listingStorage';
import {
  cloneRegionShape,
  isPointInsideRegions,
  normaliseRegionList,
  regionsAreEqual,
} from '@/services/regionShapes';
import type {
  ConfigurationProfile,
  ListingFilters,
  RegionShape,
} from '@/types';
import { filterListingsByColumnFilters } from '@/utils/listingColumnFilters';

const LOCAL_PROFILE_STORAGE_KEY = 'arcgis-config-profile:v1';
const DEFAULT_PROFILE_NAME = 'Untitled profile';

interface StoredLocalProfile {
  profileId?: string | null;
  name?: string;
  filters?: Partial<ListingFilters> | null;
  regions?: RegionShape[] | null;
  table?: Partial<ListingTableState> | null;
}

function normaliseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  const result: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (deduped.has(key)) {
      return;
    }
    deduped.add(key);
    result.push(trimmed);
  });
  return result;
}

function normaliseFilters(filters: Partial<ListingFilters> | null | undefined): ListingFilters {
  return {
    searchTerm: typeof filters?.searchTerm === 'string' ? filters.searchTerm : '',
    complex: typeof filters?.complex === 'string' ? filters.complex : '',
    owner: typeof filters?.owner === 'string' ? filters.owner : '',
    zones: normaliseStringList(filters?.zones),
    subdivisions: normaliseStringList(filters?.subdivisions),
    renewalCategories: normaliseStringList(filters?.renewalCategories),
    renewalMethods: normaliseStringList(filters?.renewalMethods),
    renewalMonths: normaliseStringList(filters?.renewalMonths),
  };
}

function stringSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const normalise = (list: string[]) =>
    list
      .map((value) => value.toLowerCase())
      .sort((first, second) => first.localeCompare(second));

  const normalisedA = normalise(a);
  const normalisedB = normalise(b);
  return normalisedA.every((value, index) => value === normalisedB[index]);
}

function filtersEqual(a: ListingFilters, b: ListingFilters): boolean {
  return (
    a.searchTerm === b.searchTerm &&
    a.complex === b.complex &&
    a.owner === b.owner &&
    stringSetsEqual(a.zones, b.zones) &&
    stringSetsEqual(a.subdivisions, b.subdivisions) &&
    stringSetsEqual(a.renewalCategories, b.renewalCategories) &&
    stringSetsEqual(a.renewalMethods, b.renewalMethods) &&
    stringSetsEqual(a.renewalMonths, b.renewalMonths)
  );
}

function HomePage(): JSX.Element {
  const {
    listings,
    loading,
    error,
    regions,
    onRegionsChange,
    cachedAt,
    source,
    supabaseConfigured,
    updateListingFavorite,
    updateListingDetails,
    revertListingToOriginal,
  } = useListings();
  const {
    watchlists,
    loading: watchlistsLoading,
    error: watchlistsError,
    supabaseConfigured: watchlistsSupabaseConfigured,
    createWatchlist,
    addListing,
    removeListing,
  } = useWatchlists();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [tableState, setTableState] = useState<ListingTableState>(() => createDefaultTableState());
  const defaultTableState = useMemo(() => createDefaultTableState(), []);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [highlightedListingId, setHighlightedListingId] = useState<string | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ConfigurationProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [localProfileId, setLocalProfileId] = useState<string | null>(null);
  const [localProfileName, setLocalProfileName] = useState(DEFAULT_PROFILE_NAME);
  const [savingProfile, setSavingProfile] = useState(false);

  const favoritesDisabledMessage = 'Connect Supabase to enable shared favorites.';
  const editDisabledMessage = 'Connect Supabase to customize listings.';
  const watchlistsDisabledMessage = 'Connect Supabase to manage shared watchlists.';

  const activeWatchlist = useMemo(
    () => watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? null,
    [selectedWatchlistId, watchlists],
  );

  useEffect(() => {
    if (!selectedWatchlistId) {
      return;
    }
    const exists = watchlists.some((watchlist) => watchlist.id === selectedWatchlistId);
    if (!exists) {
      setSelectedWatchlistId(null);
    }
  }, [selectedWatchlistId, watchlists]);

  const handleRegionsChange = useCallback(
    (nextRegions: RegionShape[]) => {
      onRegionsChange(nextRegions);
      setHighlightedListingId(null);
    },
    [onRegionsChange],
  );

  const handleFiltersChange = useCallback((nextFilters: ListingFilters) => {
    setFilters(nextFilters);
    setHighlightedListingId(null);
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    handleRegionsChange([]);
    setHighlightedListingId(null);
  }, [handleRegionsChange]);

  const handleSelectWatchlist = useCallback((watchlistId: string | null) => {
    setSelectedWatchlistId(watchlistId);
    setHighlightedListingId(null);
  }, []);

  const handleCreateWatchlist = useCallback(async () => {
    if (!watchlistsSupabaseConfigured) {
      setStatusMessage(watchlistsDisabledMessage);
      throw new Error(watchlistsDisabledMessage);
    }

    if (typeof window === 'undefined') {
      return;
    }

    const name = window.prompt('Name your new watchlist', 'New watchlist');
    if (!name) {
      return;
    }

    setStatusMessage('Creating watchlist…');
    try {
      const record = await createWatchlist(name);
      setSelectedWatchlistId(record.id);
      setStatusMessage(`Watchlist “${record.name}” created. Start selecting listings to include.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create watchlist.';
      setStatusMessage(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [createWatchlist, setStatusMessage, watchlistsDisabledMessage, watchlistsSupabaseConfigured]);

  const handleWatchlistToggle = useCallback(
    async (listingId: string, isSelected: boolean) => {
      if (!activeWatchlist) {
        return;
      }

      if (!watchlistsSupabaseConfigured) {
        setStatusMessage(watchlistsDisabledMessage);
        throw new Error(watchlistsDisabledMessage);
      }

      try {
        if (isSelected) {
          await addListing(activeWatchlist.id, listingId);
          setStatusMessage(`Listing added to ${activeWatchlist.name}.`);
        } else {
          await removeListing(activeWatchlist.id, listingId);
          setStatusMessage(`Listing removed from ${activeWatchlist.name}.`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update watchlist membership.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [
      activeWatchlist,
      addListing,
      removeListing,
      setStatusMessage,
      watchlistsDisabledMessage,
      watchlistsSupabaseConfigured,
    ],
  );

  const handleColumnOrderChange = useCallback(
    (order: ListingTableState['columnOrder']) => {
      setTableState((previous) => ({
        ...previous,
        columnOrder: [...order],
      }));
    },
    [],
  );

  const handleHiddenColumnsChange = useCallback(
    (hidden: ListingTableState['hiddenColumns']) => {
      setTableState((previous) => ({
        ...previous,
        hiddenColumns: [...hidden],
      }));
    },
    [],
  );

  const handleColumnFiltersChange = useCallback(
    (nextFilters: ListingTableState['columnFilters']) => {
      setTableState((previous) => ({
        ...previous,
        columnFilters: { ...nextFilters },
      }));
    },
    [],
  );

  const handleFavoriteChange = useCallback(
    async (listingId: string, isFavorited: boolean) => {
      if (!supabaseConfigured) {
        setStatusMessage(favoritesDisabledMessage);
        throw new Error(favoritesDisabledMessage);
      }

      try {
        await updateListingFavorite(listingId, isFavorited);
        setStatusMessage(
          isFavorited ? 'Listing added to favorites.' : 'Listing removed from favorites.',
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update favorite status.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [favoritesDisabledMessage, setStatusMessage, supabaseConfigured, updateListingFavorite],
  );

  const handleListingEdit = useCallback(
    async (listingId: string, overrides: ListingCustomizationOverrides) => {
      if (!supabaseConfigured) {
        setStatusMessage(editDisabledMessage);
        throw new Error(editDisabledMessage);
      }

      try {
        await updateListingDetails(listingId, overrides);
        setStatusMessage('Listing changes saved.');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to save listing changes.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [
      editDisabledMessage,
      setStatusMessage,
      supabaseConfigured,
      updateListingDetails,
    ],
  );

  const handleListingRevert = useCallback(
    async (listingId: string) => {
      if (!supabaseConfigured) {
        setStatusMessage(editDisabledMessage);
        throw new Error(editDisabledMessage);
      }

      try {
        await revertListingToOriginal(listingId);
        setStatusMessage('Listing restored to original data.');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to restore listing data.';
        setStatusMessage(message);
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [editDisabledMessage, setStatusMessage, supabaseConfigured, revertListingToOriginal],
  );

  const loadProfiles = useCallback(async () => {
    if (!supabaseConfigured) {
      setProfiles([]);
      setProfilesError(
        'Supabase client is not configured. Set Supabase environment variables to enable shared profiles.',
      );
      return;
    }

    setProfilesLoading(true);
    try {
      const loadedProfiles = await fetchConfigurationProfiles();
      setProfiles(loadedProfiles);
      setProfilesError(null);
    } catch (loadError) {
      console.error('Failed to load configuration profiles.', loadError);
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load configuration profiles.';
      setProfilesError(message);
    } finally {
      setProfilesLoading(false);
    }
  }, [supabaseConfigured]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, regions]);

  const filteredByFilters = useMemo(() => {
    return listings.filter((listing) => applyFilters(listing, filters));
  }, [filters, listings]);

  const filteredListings = useMemo(() => {
    if (regions.length === 0) {
      return filteredByFilters;
    }

    return filteredByFilters.filter((listing) => {
      if (typeof listing.latitude !== 'number' || typeof listing.longitude !== 'number') {
        return false;
      }
      return isPointInsideRegions({ lat: listing.latitude, lng: listing.longitude }, regions);
    });
  }, [filteredByFilters, regions]);

  const columnFilteredListings = useMemo(() => {
    return filterListingsByColumnFilters(filteredListings, tableState.columnFilters);
  }, [filteredListings, tableState.columnFilters]);

  const allColumnFilteredListings = useMemo(() => {
    return filterListingsByColumnFilters(filteredByFilters, tableState.columnFilters);
  }, [filteredByFilters, tableState.columnFilters]);

  const regionListings = useMemo(() => {
    return regions.length > 0 ? columnFilteredListings : [];
  }, [columnFilteredListings, regions.length]);

  const watchlistMembership = useMemo(() => {
    if (!activeWatchlist) {
      return new Set<string>();
    }
    return new Set<string>(activeWatchlist.listingIds);
  }, [activeWatchlist]);

  useEffect(() => {
    if (!highlightedListingId) {
      return;
    }
    const exists = columnFilteredListings.some((listing) => listing.id === highlightedListingId);
    if (!exists) {
      setHighlightedListingId(null);
    }
  }, [columnFilteredListings, highlightedListingId]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as StoredLocalProfile;
      const restoredFilters = normaliseFilters(parsed.filters);
      const restoredRegions = normaliseRegionList(parsed.regions);
      const restoredTable = normaliseTableState(parsed.table);

      setFilters(restoredFilters);
      handleRegionsChange(restoredRegions);
      setTableState(restoredTable);

      setLocalProfileId(typeof parsed.profileId === 'string' ? parsed.profileId : null);
      const storedName =
        typeof parsed.name === 'string' && parsed.name.trim().length > 0
          ? parsed.name
          : DEFAULT_PROFILE_NAME;
      setLocalProfileName(storedName);
    } catch (storageError) {
      console.warn('Unable to restore saved configuration profile from localStorage.', storageError);
    }
  }, [handleRegionsChange]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const payload: StoredLocalProfile = {
        profileId: localProfileId,
        name: localProfileName,
        filters,
        regions,
        table: {
          columnOrder: [...tableState.columnOrder],
          hiddenColumns: [...tableState.hiddenColumns],
          columnFilters: { ...tableState.columnFilters },
        },
      };
      window.localStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(payload));
    } catch (storageError) {
      console.warn('Unable to persist configuration profile to localStorage.', storageError);
    }
  }, [filters, regions, tableState, localProfileId, localProfileName]);

  const statusMessage = useMemo(() => {
    if (loading) {
      switch (source) {
        case 'local':
          return 'Loading listings from local cache…';
        case 'supabase':
          return 'Loading listings from Supabase…';
        case 'syncing':
          return 'Syncing listings from ArcGIS…';
        default:
          return 'Loading listings…';
      }
    }
    if (error) {
      return `ArcGIS request failed: ${error}`;
    }
    if (watchlistsError) {
      return `Watchlist error: ${watchlistsError}`;
    }
    if (listings.length === 0) {
      return 'No ArcGIS listings have been loaded yet.';
    }

    const baseMessage =
      filteredListings.length === listings.length
        ? `Loaded ${listings.length.toLocaleString()} listings.`
        : `Showing ${filteredListings.length.toLocaleString()} of ${listings.length.toLocaleString()} listings after filters.`;

    if (cachedAt) {
      return `${baseMessage} Supabase synced ${cachedAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}.`;
    }

    return baseMessage;
  }, [
    cachedAt,
    error,
    filteredListings.length,
    loading,
    listings.length,
    source,
    watchlistsError,
  ]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

  const selectedProfile = useMemo(() => {
    return profiles.find((profile) => profile.id === localProfileId) ?? null;
  }, [localProfileId, profiles]);

  const trimmedProfileName = localProfileName.trim();
  const isDirty = selectedProfile
    ? selectedProfile.name !== trimmedProfileName ||
      !filtersEqual(selectedProfile.filters, filters) ||
      !regionsAreEqual(selectedProfile.regions, regions) ||
      !areTableStatesEqual(selectedProfile.table, tableState)
    : trimmedProfileName !== DEFAULT_PROFILE_NAME ||
      !filtersEqual(DEFAULT_FILTERS, filters) ||
      regions.length > 0 ||
      !areTableStatesEqual(defaultTableState, tableState);

  const canSaveProfile = trimmedProfileName.length > 0;

  const persistProfile = useCallback(
    async (options?: { duplicate?: boolean }) => {
      if (!supabaseConfigured) {
        setProfilesError('Supabase client is not configured. Unable to save configuration profiles.');
        return;
      }

      const nextName = trimmedProfileName || DEFAULT_PROFILE_NAME;
      setLocalProfileName(nextName);
      setSavingProfile(true);
      try {
        const savedProfile = await saveConfigurationProfile({
          id: options?.duplicate ? undefined : localProfileId ?? undefined,
          name: nextName,
          filters: { ...filters },
          regions: regions.map((region) => cloneRegionShape(region)),
          table: {
            columnOrder: [...tableState.columnOrder],
            hiddenColumns: [...tableState.hiddenColumns],
            columnFilters: { ...tableState.columnFilters },
          },
        });
        setLocalProfileId(savedProfile.id);
        setLocalProfileName(savedProfile.name);
        setTableState({
          columnOrder: [...savedProfile.table.columnOrder],
          hiddenColumns: [...savedProfile.table.hiddenColumns],
          columnFilters: { ...savedProfile.table.columnFilters },
        });
        setProfilesError(null);
        setProfiles((current) => {
          const updated = current.filter((profile) => profile.id !== savedProfile.id);
          const nextProfiles = [...updated, savedProfile];
          nextProfiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          return nextProfiles;
        });
      } catch (saveError) {
        console.error('Failed to save configuration profile.', saveError);
        const message =
          saveError instanceof Error
            ? saveError.message
            : 'Unable to save the configuration profile.';
        setProfilesError(message);
        throw saveError;
      } finally {
        setSavingProfile(false);
      }
    },
    [
      filters,
      localProfileId,
      regions,
      supabaseConfigured,
      trimmedProfileName,
      tableState,
    ],
  );

  const handleSaveProfile = useCallback(async () => {
    try {
      await persistProfile();
    } catch {
      // Errors are surfaced via profilesError state.
    }
  }, [persistProfile]);

  const handleSaveProfileAsNew = useCallback(async () => {
    try {
      await persistProfile({ duplicate: true });
    } catch {
      // Errors are surfaced via profilesError state.
    }
  }, [persistProfile]);

  const handleProfileNameChange = useCallback((name: string) => {
    setLocalProfileName(name);
  }, []);

  const handleProfileSelect = useCallback(
    (profileId: string | null) => {
      if (!profileId) {
        setLocalProfileId(null);
        setLocalProfileName(DEFAULT_PROFILE_NAME);
        setFilters({ ...DEFAULT_FILTERS });
        handleRegionsChange([]);
        setTableState(createDefaultTableState());
        return;
      }

      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) {
        return;
      }

      setLocalProfileId(profile.id);
      setLocalProfileName(profile.name);
      setFilters({ ...profile.filters });
      handleRegionsChange(profile.regions.map((region) => ({ ...region })));
      setTableState({
        columnOrder: [...profile.table.columnOrder],
        hiddenColumns: [...profile.table.hiddenColumns],
        columnFilters: { ...profile.table.columnFilters },
      });
    },
    [handleRegionsChange, profiles],
  );

  const handleCreateProfile = useCallback(() => {
    setLocalProfileId(null);
    setLocalProfileName(DEFAULT_PROFILE_NAME);
    setFilters({ ...DEFAULT_FILTERS });
    handleRegionsChange([]);
    setTableState(createDefaultTableState());
  }, [handleRegionsChange]);

  const handleRefreshProfiles = useCallback(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const handleListingFocus = useCallback(
    (listingId: string) => {
      const index = columnFilteredListings.findIndex((listing) => listing.id === listingId);
      if (index === -1) {
        return;
      }
      const targetPage = Math.floor(index / Math.max(pageSize, 1)) + 1;
      setCurrentPage(targetPage);
      setHighlightedListingId(listingId);
    },
    [columnFilteredListings, pageSize],
  );

  return (
    <>
      <section className="app__section app__section--sidebar">
        <FilterPanel
          filters={filters}
          onChange={handleFiltersChange}
          disabled={loading || watchlistsLoading}
          onReset={handleResetFilters}
          watchlistControls={{
            options: watchlists.map((watchlist) => ({
              id: watchlist.id,
              name: watchlist.name,
              listingCount: watchlist.listingIds.length,
            })),
            selectedWatchlistId,
            onSelectWatchlist: handleSelectWatchlist,
            onCreateWatchlist: handleCreateWatchlist,
            isBusy: watchlistsLoading,
            canManage: watchlistsSupabaseConfigured,
            createDisabledReason: watchlistsSupabaseConfigured
              ? undefined
              : watchlistsDisabledMessage,
            errorMessage: watchlistsError,
            activeSummary: activeWatchlist
              ? {
                  name: activeWatchlist.name,
                  listingCount: activeWatchlist.listingIds.length,
                }
              : null,
          }}
        />
      </section>
      <section className="app__section app__section--main">
        <RegionMap
          regions={regions}
          onRegionsChange={handleRegionsChange}
          listings={regionListings}
          allListings={allColumnFilteredListings}
          onListingSelect={handleListingFocus}
          totalListingCount={allColumnFilteredListings.length}
        />
      </section>
      <CollapsibleSection
        title="Saved configuration profiles"
        description="Capture and recall map shapes, filters, and column settings. Profiles sync through Supabase when available."
        className="collapsible-section--full"
      >
        <ConfigurationProfiles
          profiles={profiles}
          loading={profilesLoading}
          error={profilesError}
          selectedProfile={selectedProfile}
          selectedProfileId={localProfileId}
          profileName={localProfileName}
          isDirty={isDirty}
          canSave={canSaveProfile}
          saving={savingProfile}
          onProfileNameChange={handleProfileNameChange}
          onSelectProfile={handleProfileSelect}
          onSaveProfile={handleSaveProfile}
          onSaveProfileAsNew={handleSaveProfileAsNew}
          onCreateProfile={handleCreateProfile}
          onRefreshProfiles={handleRefreshProfiles}
          supabaseAvailable={supabaseConfigured}
        />
      </CollapsibleSection>
      <CollapsibleSection
        title="Listing results"
        description="Browse the current results set with sortable, paginated tables and column controls."
        className="collapsible-section--full"
        collapsible={false}
        defaultCollapsed={false}
      >
        <ListingTable
          listings={filteredListings}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          isLoading={loading}
          error={error}
          highlightedListingId={highlightedListingId ?? undefined}
          columnOrder={tableState.columnOrder}
          hiddenColumns={tableState.hiddenColumns}
          columnFilters={tableState.columnFilters}
          onColumnOrderChange={handleColumnOrderChange}
          onHiddenColumnsChange={handleHiddenColumnsChange}
          onColumnFiltersChange={handleColumnFiltersChange}
          onFavoriteChange={handleFavoriteChange}
          onListingEdit={handleListingEdit}
          onListingRevert={handleListingRevert}
          canToggleFavorites={supabaseConfigured}
          favoriteDisabledReason={favoritesDisabledMessage}
          selectionMode={activeWatchlist ? 'watchlist' : 'favorites'}
          selectedListingIds={activeWatchlist ? watchlistMembership : undefined}
          onSelectionChange={activeWatchlist ? handleWatchlistToggle : undefined}
          canChangeSelection={activeWatchlist ? watchlistsSupabaseConfigured : undefined}
          selectionDisabledReason={activeWatchlist ? watchlistsDisabledMessage : undefined}
          selectionLabel={activeWatchlist ? `${activeWatchlist.name} membership` : undefined}
          canEditListings={supabaseConfigured}
          editDisabledReason={editDisabledMessage}
        />
      </CollapsibleSection>
      <CollapsibleSection
        title="Market insights"
        description="Supabase-derived renewal timelines, subdivision hotspots, and zoning opportunities tailored to your filters."
        className="collapsible-section--full"
      >
        <ListingInsights
          supabaseAvailable={supabaseConfigured}
          filters={filters}
          onFiltersChange={handleFiltersChange}
        />
      </CollapsibleSection>
    </>
  );
}

export default HomePage;
