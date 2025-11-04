import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArcgisFeature, ArcgisResponse, GeoCircle } from './types';
import { Toolbar } from './components/Toolbar';
import { FilterPanel } from './components/FilterPanel';
import { GeoMap } from './components/GeoMap';
import { DataTable } from './components/DataTable';
import { filterByCircles } from './utils/geo';
import {
  FieldDefinition,
  createFieldDefinition,
  createFieldDefinitionFromName,
} from './utils/fields';
import { getFeatureId } from './utils/features';

const CACHE_KEY = 'arcgis-properties-cache-v2';

interface CachePayload {
  data: ArcgisResponse;
  timestamp: string;
}

async function fetchProperties(): Promise<ArcgisResponse> {
  const response = await fetch('/api/properties');
  if (!response.ok) {
    throw new Error(`Failed to fetch properties: ${response.status}`);
  }
  return (await response.json()) as ArcgisResponse;
}

function loadCache(): CachePayload | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CachePayload;
    return parsed;
  } catch (error) {
    console.warn('Failed to parse cached data', error);
    return null;
  }
}

function saveCache(payload: CachePayload) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

export default function App() {
  const [features, setFeatures] = useState<ArcgisFeature[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [circles, setCircles] = useState<GeoCircle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);

  const applyFilters = useCallback(
    (source: ArcgisFeature[], activeFilters: Record<string, string>, activeCircles: GeoCircle[]) => {
      const fieldFiltered = source.filter((feature) =>
        Object.entries(activeFilters).every(([field, value]) => {
          if (!value) {
            return true;
          }
          const attribute = feature.attributes[field];
          if (attribute === undefined || attribute === null) {
            return false;
          }
          return String(attribute).toLowerCase().includes(value.toLowerCase());
        })
      );

      return filterByCircles(fieldFiltered, activeCircles);
    },
    []
  );

  const filteredFeatures = useMemo(
    () => applyFilters(features, filters, circles),
    [features, filters, circles, applyFilters]
  );

  const loadData = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setError(null);
      try {
        let payload: ArcgisResponse | null = null;
        let timestamp = new Date();

        if (!forceRefresh) {
          const cached = loadCache();
          if (cached) {
            payload = cached.data;
            timestamp = new Date(cached.timestamp);
          }
        }

        if (!payload) {
          payload = await fetchProperties();
          timestamp = new Date();
          saveCache({ data: payload, timestamp: timestamp.toISOString() });
        }

        const loadedFeatures = payload.features ?? [];
        setFeatures(loadedFeatures);

        if (payload.fields && payload.fields.length) {
          setFields(payload.fields.map((field) => createFieldDefinition(field)));
        } else if (loadedFeatures.length) {
          const attributeKeys = Object.keys(loadedFeatures[0].attributes ?? {});
          setFields(attributeKeys.map((key) => createFieldDefinitionFromName(key)));
        } else {
          setFields([]);
        }
        setLastUpdated(timestamp);
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleResetFilters = () => {
    setFilters({});
    setSelectedFeatureId(null);
  };

  const handleCirclesChange = useCallback((next: GeoCircle[]) => {
    setCircles(next);
  }, []);

  const handleSelectFeature = useCallback((featureId: string | null) => {
    setSelectedFeatureId(featureId);
  }, []);

  useEffect(() => {
    if (!selectedFeatureId) {
      return;
    }
    const exists = filteredFeatures.some(
      (feature) => getFeatureId(feature) === selectedFeatureId
    );
    if (!exists) {
      setSelectedFeatureId(null);
    }
  }, [filteredFeatures, selectedFeatureId]);

  const handleRefresh = () => {
    localStorage.removeItem(CACHE_KEY);
    void loadData(true);
  };

  return (
    <div className="app">
      <Toolbar isRefreshing={isLoading} onRefresh={handleRefresh} lastUpdated={lastUpdated} />
      {error && <div className="error">{error}</div>}
      <main className="layout">
        <div className="layout__column layout__column--sidebar">
          <FilterPanel
            fields={fields}
            filters={filters}
            onFilterChange={handleFilterChange}
            onReset={handleResetFilters}
          />
        </div>
        <div className="layout__column layout__column--content">
          <GeoMap
            features={filteredFeatures}
            circles={circles}
            onCirclesChange={handleCirclesChange}
            selectedFeatureId={selectedFeatureId}
            onSelectFeature={handleSelectFeature}
          />
          <DataTable
            fields={fields}
            features={filteredFeatures}
            selectedFeatureId={selectedFeatureId}
            onSelectFeature={handleSelectFeature}
          />
        </div>
      </main>
    </div>
  );
}
