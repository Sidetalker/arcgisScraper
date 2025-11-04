import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import ConfigurationProfilePanel from '@/components/ConfigurationProfilePanel';
import FilterPanel from '@/components/FilterPanel';
import ListingTable from '@/components/ListingTable';
import RegionMap from '@/components/RegionMap';
import { type LayoutOutletContext } from '@/App';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE } from '@/constants/listings';
import { DEFAULT_PROFILE_NAME, normaliseProfileConfiguration } from '@/constants/profiles';
import { createDefaultListingTableViewState, normaliseListingTableViewState } from '@/constants/listingTable';
import { useListings } from '@/context/ListingsContext';
import { applyFilters } from '@/services/listingTransformer';
import { loadLocalProfile, saveLocalProfile } from '@/services/profileLocalStorage';
import { fetchConfigurationProfiles, saveConfigurationProfile } from '@/services/profileStorage';
import type {
  ConfigurationProfile,
  ListingFilters,
  ListingTableColumnKey,
  ListingTableViewState,
  ProfileConfiguration,
  RegionCircle,
} from '@/types';

function areListingFiltersEqual(a: ListingFilters, b: ListingFilters): boolean {
  return a.searchTerm === b.searchTerm && a.complex === b.complex && a.owner === b.owner;
}

function areRegionsEqual(a: RegionCircle[], b: RegionCircle[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((region, index) => {
    const other = b[index];
    return (
      Boolean(other) &&
      region.lat === other.lat &&
      region.lng === other.lng &&
      region.radius === other.radius
    );
  });
}

function areTableStatesEqual(a: ListingTableViewState, b: ListingTableViewState): boolean {
  const first = normaliseListingTableViewState(a);
  const second = normaliseListingTableViewState(b);
  const arraysEqual = <T,>(x: readonly T[], y: readonly T[]) =>
    x.length === y.length && x.every((value, index) => value === y[index]);

  if (!arraysEqual(first.columnOrder, second.columnOrder)) {
    return false;
  }
  if (!arraysEqual(first.hiddenColumns, second.hiddenColumns)) {
    return false;
  }

  const keys = new Set<keyof ListingTableViewState['columnFilters']>([
    ...Object.keys(first.columnFilters),
    ...Object.keys(second.columnFilters),
  ]);

  for (const key of keys) {
    const typedKey = key as ListingTableColumnKey;
    if (first.columnFilters[typedKey] !== second.columnFilters[typedKey]) {
      return false;
    }
  }

  return true;
}

function areProfileConfigurationsEqual(a: ProfileConfiguration, b: ProfileConfiguration): boolean {
  return (
    areListingFiltersEqual(a.filters, b.filters) &&
    areRegionsEqual(a.regions, b.regions) &&
    areTableStatesEqual(a.table, b.table)
  );
}

interface ProfileSnapshot {
  profileId: string | null;
  name: string;
  configuration: ProfileConfiguration;
}

function isListingInsideRegions(
  listing: { latitude: number | null; longitude: number | null },
  regions: RegionCircle[],
): boolean {
  if (regions.length === 0) {
    return true;
  }

  if (typeof listing.latitude !== 'number' || typeof listing.longitude !== 'number') {
    return false;
  }

  const { latitude, longitude } = listing;
  const EARTH_RADIUS_METERS = 6_371_000;

  return regions.some((region) => {
    const lat1 = (latitude * Math.PI) / 180;
    const lat2 = (region.lat * Math.PI) / 180;
    const deltaLat = ((region.lat - latitude) * Math.PI) / 180;
    const deltaLng = ((region.lng - longitude) * Math.PI) / 180;

    const haversine =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const distance = 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    return distance <= region.radius;
  });
}

function HomePage(): JSX.Element {
  const { listings, loading, error, regions, onRegionsChange, cachedAt, source } = useListings();
  const { setStatusMessage } = useOutletContext<LayoutOutletContext>();

  const [filters, setFilters] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedListingId, setHighlightedListingId] = useState<string | null>(null);
  const [tableViewState, setTableViewState] = useState<ListingTableViewState>(
    () => createDefaultListingTableViewState(),
  );
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState(DEFAULT_PROFILE_NAME);
  const [savedSnapshot, setSavedSnapshot] = useState<ProfileSnapshot | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [profiles, setProfiles] = useState<ConfigurationProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const handleRegionsChange = useCallback(
    (nextRegions: RegionCircle[]) => {
      onRegionsChange(nextRegions);
      setHighlightedListingId(null);
    },
    [onRegionsChange],
  );

  const handleFiltersChange = useCallback(
    (nextFilters: ListingFilters) => {
      setFilters(nextFilters);
      setHighlightedListingId(null);
    },
    [],
  );

  const handleTableViewStateChange = useCallback((nextState: ListingTableViewState) => {
    setTableViewState(normaliseListingTableViewState(nextState));
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    handleRegionsChange([]);
    setHighlightedListingId(null);
  }, [handleRegionsChange]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, regions]);

  const filteredListings = useMemo(() => {
    const filtered = listings.filter((listing) => applyFilters(listing, filters));
    if (regions.length === 0) {
      return filtered;
    }
    return filtered.filter((listing) => isListingInsideRegions(listing, regions));
  }, [filters, listings, regions]);

  const circleListings = useMemo(() => {
    return regions.length > 0 ? filteredListings : [];
  }, [filteredListings, regions.length]);

  useEffect(() => {
    const stored = loadLocalProfile();
    if (!stored) {
      setProfileId(null);
      setProfileName(DEFAULT_PROFILE_NAME);
      setSavedSnapshot(null);
      setLastSavedAt(null);
      return;
    }

    const configuration = normaliseProfileConfiguration(stored.configuration);
    setProfileId(stored.profileId ?? null);
    setProfileName(stored.name.trim().length > 0 ? stored.name : DEFAULT_PROFILE_NAME);
    setFilters(configuration.filters);
    setTableViewState(configuration.table);
    handleRegionsChange(configuration.regions);
    setSavedSnapshot(null);
    setLastSavedAt(null);
  }, [handleRegionsChange]);

  useEffect(() => {
    if (!highlightedListingId) {
      return;
    }
    const exists = filteredListings.some((listing) => listing.id === highlightedListingId);
    if (!exists) {
      setHighlightedListingId(null);
    }
  }, [filteredListings, highlightedListingId]);

  const currentConfiguration = useMemo(() => {
    return normaliseProfileConfiguration({
      filters,
      regions,
      table: tableViewState,
    });
  }, [filters, regions, tableViewState]);

  const hasUnsavedChanges = useMemo(() => {
    if (!savedSnapshot) {
      return true;
    }
    if (savedSnapshot.profileId !== profileId) {
      return true;
    }
    if (savedSnapshot.name !== profileName) {
      return true;
    }
    return !areProfileConfigurationsEqual(savedSnapshot.configuration, currentConfiguration);
  }, [currentConfiguration, profileId, profileName, savedSnapshot]);

  useEffect(() => {
    saveLocalProfile({
      profileId,
      name: profileName,
      configuration: currentConfiguration,
    });
  }, [currentConfiguration, profileId, profileName]);

  const refreshProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const results = await fetchConfigurationProfiles();
      setProfiles(results);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load configuration profiles.';
      setProfilesError(message);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const performSave = useCallback(
    async (targetId?: string) => {
      const trimmedName = profileName.trim();
      const resolvedName = trimmedName.length > 0 ? trimmedName : DEFAULT_PROFILE_NAME;

      setSavingProfile(true);
      setProfilesError(null);

      try {
        const saved = await saveConfigurationProfile({
          id: targetId,
          name: resolvedName,
          configuration: currentConfiguration,
        });
        setProfileId(saved.id);
        setProfileName(saved.name);
        setSavedSnapshot({
          profileId: saved.id,
          name: saved.name,
          configuration: saved.configuration,
        });
        setLastSavedAt(saved.updatedAt ?? saved.createdAt ?? new Date());
        setProfiles((previous) => {
          const existingIndex = previous.findIndex((profile) => profile.id === saved.id);
          if (existingIndex === -1) {
            return [saved, ...previous];
          }
          const next = [...previous];
          next[existingIndex] = saved;
          return next;
        });
        await refreshProfiles();
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : 'Unable to save configuration profile.';
        setProfilesError(message);
      } finally {
        setSavingProfile(false);
      }
    },
    [currentConfiguration, profileName, refreshProfiles],
  );

  const handleSaveProfile = useCallback(() => {
    if (savingProfile) {
      return;
    }
    void performSave(profileId ?? undefined);
  }, [performSave, profileId, savingProfile]);

  const handleSaveProfileAsNew = useCallback(() => {
    if (savingProfile) {
      return;
    }
    void performSave(undefined);
  }, [performSave, savingProfile]);

  const handleLoadProfile = useCallback(
    (profileIdentifier: string) => {
      if (!profileIdentifier) {
        return;
      }
      const profile = profiles.find((item) => item.id === profileIdentifier);
      if (!profile) {
        return;
      }

      const configuration = normaliseProfileConfiguration(profile.configuration);
      const resolvedName = profile.name.trim().length > 0 ? profile.name : DEFAULT_PROFILE_NAME;
      setProfileId(profile.id);
      setProfileName(resolvedName);
      setFilters(configuration.filters);
      setTableViewState(configuration.table);
      handleRegionsChange(configuration.regions);
      setSavedSnapshot({
        profileId: profile.id,
        name: resolvedName,
        configuration,
      });
      setLastSavedAt(profile.updatedAt ?? profile.createdAt ?? null);
      setHighlightedListingId(null);
    },
    [handleRegionsChange, profiles],
  );

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
  }, [cachedAt, error, filteredListings.length, loading, listings.length]);

  useEffect(() => {
    setStatusMessage(statusMessage);
  }, [setStatusMessage, statusMessage]);

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
        listings={circleListings}
        onListingSelect={handleListingFocus}
      />
      <ConfigurationProfilePanel
        profileName={profileName}
        onProfileNameChange={setProfileName}
        onSaveProfile={handleSaveProfile}
        onSaveProfileAsNew={handleSaveProfileAsNew}
        saving={savingProfile}
        hasUnsavedChanges={hasUnsavedChanges}
        activeProfileId={profileId}
        profiles={profiles}
        loadingProfiles={profilesLoading}
        onLoadProfile={handleLoadProfile}
        onRefreshProfiles={refreshProfiles}
        error={profilesError}
        lastSavedAt={lastSavedAt}
      />
      <div className="app__listings">
        <ListingTable
          listings={filteredListings}
          pageSize={DEFAULT_PAGE_SIZE}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isLoading={loading}
          error={error}
          highlightedListingId={highlightedListingId ?? undefined}
          viewState={tableViewState}
          onViewStateChange={handleTableViewStateChange}
        />
      </div>
    </>
  );
}

export default HomePage;
