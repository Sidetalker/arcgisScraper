import { useCallback, useEffect, useMemo, useState } from 'react';

import './App.css';
import { useCache } from './context/CacheContext';

interface Region {
  id: string;
  name: string;
  description: string;
}

interface RegionData {
  regionId: string;
  regionName: string;
  updatedAt: string;
  listingCount: number;
  message: string;
}

const SAVED_REGIONS: Region[] = [
  {
    id: 'summit',
    name: 'Summit County, CO',
    description: 'County-wide snapshot of active short-term rental permits.',
  },
  {
    id: 'breckenridge',
    name: 'Breckenridge',
    description: 'Breckenridge resort area licenses and availability.',
  },
  {
    id: 'frisco',
    name: 'Frisco',
    description: 'Town of Frisco permit activity and compliance data.',
  },
];

const CACHE_KEY = 'region-data';
const REGION_DATA_TTL = 1000 * 60 * 60 * 6; // 6 hours

async function fetchRegionData(region: Region): Promise<RegionData> {
  await new Promise((resolve) => setTimeout(resolve, 350));

  const listingCount = Math.floor(120 + Math.random() * 180);
  return {
    regionId: region.id,
    regionName: region.name,
    updatedAt: new Date().toISOString(),
    listingCount,
    message: `Updated summary for ${region.name}`,
  };
}

function formatDateTime(value?: number | null | string): string {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function App(): JSX.Element {
  const { entries, get, set, clear } = useCache();
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);

  const snapshots = useMemo(() => {
    const regionEntries = new Map<string, { storedAt: number; expiresAt: number | null; data: RegionData }>();

    entries.forEach((entry) => {
      if (entry.key !== CACHE_KEY) {
        return;
      }

      const dependency = entry.dependencies[0];
      if (typeof dependency !== 'string') {
        return;
      }

      regionEntries.set(dependency, {
        storedAt: entry.storedAt,
        expiresAt: entry.expiresAt,
        data: entry.value as RegionData,
      });
    });

    return regionEntries;
  }, [entries]);

  const loadRegion = useCallback(
    async (region: Region, force = false): Promise<RegionData | undefined> => {
      if (!force) {
        const cached = get<RegionData>(CACHE_KEY, { dependencies: [region.id] });
        if (cached) {
          return cached;
        }
      }

      setErrors((previous) => ({ ...previous, [region.id]: undefined }));
      setLoading((previous) => ({ ...previous, [region.id]: true }));

      try {
        const data = await fetchRegionData(region);
        set(CACHE_KEY, data, { dependencies: [region.id], ttl: REGION_DATA_TTL });
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to fetch region data';
        setErrors((previous) => ({ ...previous, [region.id]: message }));
        return undefined;
      } finally {
        setLoading((previous) => ({ ...previous, [region.id]: false }));
      }
    },
    [get, set],
  );

  useEffect(() => {
    SAVED_REGIONS.forEach((region) => {
      void loadRegion(region);
    });
  }, [loadRegion]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshingAll(true);
    clear(CACHE_KEY);

    await Promise.all(
      SAVED_REGIONS.map((region) =>
        loadRegion(region, true).catch((error) => {
          console.error(`Failed to refresh region ${region.id}`, error);
        }),
      ),
    );

    setRefreshingAll(false);
  }, [clear, loadRegion]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS Region Monitor</h1>
          <p>Persist region data with TTL-aware caching and update everything with a single click.</p>
        </div>
        <button
          type="button"
          className="app__refresh-all"
          onClick={() => {
            void handleRefreshAll();
          }}
          disabled={refreshingAll}
        >
          {refreshingAll ? 'Refreshing…' : 'Update All Data'}
        </button>
      </header>

      <main className="app__content">
        <section className="regions">
          <h2>Saved Regions</h2>
          <ul className="regions__list">
            {SAVED_REGIONS.map((region) => {
              const snapshot = snapshots.get(region.id);
              const data = snapshot?.data;
              const isLoading = loading[region.id];
              const error = errors[region.id];

              return (
                <li key={region.id} className="region-card">
                  <div className="region-card__header">
                    <div>
                      <h3>{region.name}</h3>
                      <p className="region-card__description">{region.description}</p>
                    </div>
                    <button
                      type="button"
                      className="region-card__refresh"
                      onClick={() => {
                        void loadRegion(region, true);
                      }}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Updating…' : 'Refresh'}
                    </button>
                  </div>

                  {error ? (
                    <p className="region-card__error">{error}</p>
                  ) : (
                    <div className="region-card__body">
                      <dl>
                        <div>
                          <dt>Listings Snapshot</dt>
                          <dd>{data ? data.listingCount.toLocaleString() : '—'}</dd>
                        </div>
                        <div>
                          <dt>Summary</dt>
                          <dd>{data ? data.message : 'Data not cached yet.'}</dd>
                        </div>
                        <div>
                          <dt>Last Updated</dt>
                          <dd>{data ? formatDateTime(data.updatedAt) : '—'}</dd>
                        </div>
                        <div>
                          <dt>Cache Expires</dt>
                          <dd>{snapshot ? formatDateTime(snapshot.expiresAt) : '—'}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
