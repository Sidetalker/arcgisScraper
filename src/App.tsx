import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DataTable } from './components/DataTable';
import { FiltersPanel } from './components/FiltersPanel';
import { MapRegionDrawer } from './components/MapRegionDrawer';
import { RegionList } from './components/RegionList';
import { usePersistentCache } from './hooks/usePersistentCache';
import { fetchFeaturesForRegion } from './services/arcgis';
import type { ArcGisFeature, FilterRule, GeoRegion } from './types';

interface RegionCacheEntry {
  features: ArcGisFeature[];
  updatedAt: string;
}

const CACHE_KEY = 'arcgis-rental-cache';
const CACHE_VERSION = 1;

function regionCacheKey(region: GeoRegion) {
  const lat = region.center.lat.toFixed(5);
  const lng = region.center.lng.toFixed(5);
  const radius = Math.round(region.radiusMeters);
  return `${lat},${lng}:${radius}`;
}

function uniqueFieldsFrom(features: ArcGisFeature[]): string[] {
  const fields = new Set<string>();
  features.forEach((feature) => {
    Object.keys(feature.attributes).forEach((key) => fields.add(key));
  });
  return Array.from(fields).sort((a, b) => a.localeCompare(b));
}

function applyFilters(features: ArcGisFeature[], filters: FilterRule[]) {
  if (filters.length === 0) {
    return features;
  }

  return features.filter((feature) =>
    filters.every((filter) => {
      const rawValue = feature.attributes[filter.field];
      if (rawValue === null || rawValue === undefined) {
        return false;
      }
      if (!filter.value) {
        return true;
      }
      return String(rawValue).toLowerCase().includes(filter.value.toLowerCase());
    })
  );
}

export default function App() {
  const [regions, setRegions] = useState<GeoRegion[]>([]);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [visibleFields, setVisibleFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [regionFeatures, setRegionFeatures] = useState<Record<string, ArcGisFeature[]>>({});

  const regionFeaturesRef = useRef(regionFeatures);
  const regionKeyRef = useRef<Record<string, string>>({});

  useEffect(() => {
    regionFeaturesRef.current = regionFeatures;
  }, [regionFeatures]);

  const { getEntry, setEntry, clear, payload } = usePersistentCache<RegionCacheEntry>(
    CACHE_KEY,
    CACHE_VERSION
  );

  useEffect(() => {
    const controllers: AbortController[] = [];
    let cancelled = false;
    const currentKeys = regionKeyRef.current;
    const nextFeatures: Record<string, ArcGisFeature[]> = { ...regionFeaturesRef.current };
    const seen = new Set<string>();

    Object.keys(nextFeatures).forEach((id) => {
      if (!regions.some((region) => region.id === id)) {
        delete nextFeatures[id];
      }
    });

    regions.forEach((region) => {
      const key = regionCacheKey(region);
      seen.add(region.id);
      if (currentKeys[region.id] !== key) {
        currentKeys[region.id] = key;
        delete nextFeatures[region.id];
      }
    });

    Object.keys(currentKeys).forEach((id) => {
      if (!seen.has(id)) {
        delete currentKeys[id];
      }
    });

    regions.forEach((region) => {
      const key = currentKeys[region.id];
      const cached = getEntry(key);
      if (cached) {
        nextFeatures[region.id] = cached.features;
      }
    });

    const keysA = Object.keys(nextFeatures);
    const keysB = Object.keys(regionFeaturesRef.current);
    const isSame =
      keysA.length === keysB.length && keysA.every((key) => regionFeaturesRef.current[key] === nextFeatures[key]);

    if (!isSame) {
      setRegionFeatures(nextFeatures);
      regionFeaturesRef.current = nextFeatures;
    }

    setLoadingIds((prev) => prev.filter((id) => seen.has(id)));

    regions.forEach((region) => {
      if (nextFeatures[region.id]) {
        return;
      }

      const key = currentKeys[region.id];
      const controller = new AbortController();
      controllers.push(controller);
      setLoadingIds((prev) => (prev.includes(region.id) ? prev : [...prev, region.id]));

      fetchFeaturesForRegion(region, { signal: controller.signal })
        .then((features) => {
          if (cancelled) {
            return;
          }
          setEntry(key, { features, updatedAt: new Date().toISOString() });
          const updated = { ...regionFeaturesRef.current, [region.id]: features } as Record<string, ArcGisFeature[]>;
          regionFeaturesRef.current = updated;
          setRegionFeatures(updated);
        })
        .catch((err: unknown) => {
          if (cancelled) {
            return;
          }
          if ((err as Error)?.name === 'AbortError') {
            return;
          }
          setError((err as Error).message ?? 'Failed to query ArcGIS data.');
        })
        .finally(() => {
          if (cancelled) {
            return;
          }
          setLoadingIds((prev) => prev.filter((id) => id !== region.id));
        });
    });

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [regions, getEntry, setEntry, refreshToken]);

  const mergedFeatures = useMemo(() => {
    return regions.flatMap((region) => regionFeatures[region.id] ?? []);
  }, [regionFeatures, regions]);

  const availableFields = useMemo(() => uniqueFieldsFrom(mergedFeatures), [mergedFeatures]);

  useEffect(() => {
    if (availableFields.length === 0) {
      setVisibleFields([]);
      return;
    }
    if (visibleFields.length === 0) {
      setVisibleFields(availableFields.slice(0, Math.min(availableFields.length, 6)));
      return;
    }
    const updatedFields = visibleFields.filter((field) => availableFields.includes(field));
    if (updatedFields.length !== visibleFields.length) {
      setVisibleFields(updatedFields);
    }
  }, [availableFields, visibleFields]);

  const filteredFeatures = useMemo(() => applyFilters(mergedFeatures, filters), [filters, mergedFeatures]);

  const handleRegionsChange = useCallback((nextRegions: GeoRegion[]) => {
    setError(null);
    setRegions(nextRegions);
  }, []);

  const handleRemoveRegion = useCallback((id: string) => {
    setRegions((prev) => prev.filter((region) => region.id !== id));
  }, []);

  const handleToggleField = useCallback(
    (field: string) => {
      setVisibleFields((prev) => {
        if (prev.includes(field)) {
          return prev.filter((item) => item !== field);
        }
        return [...prev, field];
      });
    },
    []
  );

  const handleSelectAllFields = useCallback(() => {
    setVisibleFields(availableFields);
  }, [availableFields]);

  const handleClearFields = useCallback(() => {
    setVisibleFields([]);
  }, []);

  const handleUpdateAllData = useCallback(() => {
    clear();
    regionKeyRef.current = {};
    setRegionFeatures({});
    regionFeaturesRef.current = {};
    setLoadingIds([]);
    setRefreshToken(Date.now());
  }, [clear]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Summit County STR Explorer</h1>
        <p>
          Draw geographic search regions, fetch Summit County short-term rental permits directly from ArcGIS, and
          filter the results in real time. Cached responses are stored locally so repeat queries are instant.
        </p>
      </header>
      <main className="app-body">
        <div className="layout-grid">
          <section className="panel">
            <h2>Search regions</h2>
            <MapRegionDrawer regions={regions} onRegionsChange={handleRegionsChange} />
            <RegionList regions={regions} loadingRegionIds={loadingIds} onRemoveRegion={handleRemoveRegion} />
            <button className="danger-button" type="button" onClick={handleUpdateAllData}>
              Update all data
            </button>
            <small>
              Cached responses: {Object.keys(payload.entries).length}. Clearing the cache triggers fresh ArcGIS queries for
              every region.
            </small>
          </section>
          <section className="panel">
            <h2>Filters</h2>
            {error ? <div className="error-banner">{error}</div> : null}
            <FiltersPanel availableFields={availableFields} filters={filters} onFiltersChange={setFilters} />
            <div>
              <div className="status-bar" style={{ marginTop: '0.5rem' }}>
                <span className="status-pill">{filteredFeatures.length} results</span>
                <button className="secondary-button" type="button" onClick={handleSelectAllFields}>
                  Show all fields
                </button>
                <button className="secondary-button" type="button" onClick={handleClearFields}>
                  Clear fields
                </button>
              </div>
              <div className="field-select" style={{ marginTop: '0.75rem' }}>
                {availableFields.map((field) => (
                  <span key={field} className="field-chip">
                    <label style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={visibleFields.includes(field)}
                        onChange={() => handleToggleField(field)}
                        style={{ marginRight: '0.35rem' }}
                      />
                      {field}
                    </label>
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
        <section className="panel">
          <h2>Rental permits</h2>
          <DataTable features={filteredFeatures} fields={visibleFields} />
        </section>
      </main>
    </div>
  );
}
