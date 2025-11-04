import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

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
import { applyFilters } from '@/services/listingTransformer';
import {
  fetchConfigurationProfiles,
  saveConfigurationProfile,
} from '@/services/configurationProfiles';
import {
  cloneRegionShape,
  isPointInsideRegions,
  normaliseRegionList,
  regionsAreEqual,
} from '@/services/regionShapes';
import { supabase } from '@/services/supabaseClient';
import type {
  ConfigurationProfile,
  ListingFilters,
  RegionShape,
} from '@/types';

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
    stringSetsEqual(a.subdivisions, b.subdivisions) &&
    stringSetsEqual(a.renewalCategories, b.renewalCategories) &&
    stringSetsEqual(a.renewalMethods, b.renewalMethods) &&
    stringSetsEqual(a.renewalMonths, b.renewalMonths)
  );
}

function HomePage(): JSX.Element {
  const { listings, loading, error, regions, onRegionsChange, cachedAt, source } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [tableState, setTableState] = useState<ListingTableState>(() => createDefaultTableState());
  const defaultTableState = useMemo(() => createDefaultTableState(), []);
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedListingId, setHighlightedListingId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ConfigurationProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [localProfileId, setLocalProfileId] = useState<string | null>(null);
  const [localProfileName, setLocalProfileName] = useState(DEFAULT_PROFILE_NAME);
  const [savingProfile, setSavingProfile] = useState(false);

  const supabaseAvailable = Boolean(supabase);

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

  const loadProfiles = useCallback(async () => {
    if (!supabaseAvailable) {
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
  }, [supabaseAvailable]);

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

  const regionListings = useMemo(() => {
    return regions.length > 0 ? filteredListings : [];
  }, [filteredListings, regions.length]);

  useEffect(() => {
    if (!highlightedListingId) {
      return;
    }
    const exists = filteredListings.some((listing) => listing.id === highlightedListingId);
    if (!exists) {
      setHighlightedListingId(null);
    }
  }, [filteredListings, highlightedListingId]);

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
  }, [cachedAt, error, filteredListings.length, loading, listings.length, source]);

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
      if (!supabaseAvailable) {
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
      supabaseAvailable,
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
      const index = filteredListings.findIndex((listing) => listing.id === listingId);
      if (index === -1) {
        return;
      }
      const targetPage = Math.floor(index / DEFAULT_PAGE_SIZE) + 1;
      setCurrentPage(targetPage);
      setHighlightedListingId(listingId);
    },
    [filteredListings],
  );

  return (
    <>
      <FilterPanel
        filters={filters}
        onChange={handleFiltersChange}
        disabled={loading}
        onReset={handleResetFilters}
      />
      <RegionMap
        regions={regions}
        onRegionsChange={handleRegionsChange}
        listings={regionListings}
        allListings={filteredByFilters}
        onListingSelect={handleListingFocus}
        totalListingCount={filteredByFilters.length}
      />
      <ListingInsights
        supabaseAvailable={supabaseAvailable}
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />
      <div className="app__listings">
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
          supabaseAvailable={supabaseAvailable}
        />
        <ListingTable
          listings={filteredListings}
          pageSize={DEFAULT_PAGE_SIZE}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isLoading={loading}
          error={error}
          highlightedListingId={highlightedListingId ?? undefined}
          columnOrder={tableState.columnOrder}
          hiddenColumns={tableState.hiddenColumns}
          columnFilters={tableState.columnFilters}
          onColumnOrderChange={handleColumnOrderChange}
          onHiddenColumnsChange={handleHiddenColumnsChange}
          onColumnFiltersChange={handleColumnFiltersChange}
        />
      </div>
    </>
  );
}

export default HomePage;
