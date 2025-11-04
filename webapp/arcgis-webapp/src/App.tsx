import { useCallback, useMemo, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import './App.css';

import HomePage from '@/pages/HomePage';
import ComplexDetailPage from '@/pages/ComplexDetailPage';
import OwnerDetailPage from '@/pages/OwnerDetailPage';
import { useListings } from '@/context/ListingsContext';

export type LayoutOutletContext = {
  setStatusMessage: (message: string) => void;
};

function Layout(): JSX.Element {
  const {
    loading,
    cachedAt,
    localCachedAt,
    isLocalCacheStale,
    source,
    syncing,
    syncFromArcgis,
    clearCacheAndReload,
    syncEvents,
  } = useListings();
  const [statusMessage, setStatusMessage] = useState('Loading listings…');

  const handleStatusChange = useCallback((message: string) => {
    setStatusMessage(message || 'Ready.');
  }, []);

  const contextValue = useMemo(
    () => ({
      setStatusMessage: handleStatusChange,
    }),
    [handleStatusChange],
  );

  const supabaseSummary = useMemo(() => {
    if (!cachedAt) {
      return 'ArcGIS source of truth sync pending';
    }
    return `ArcGIS source of truth synced ${cachedAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}`;
  }, [cachedAt]);

  const localSummary = useMemo(() => {
    if (!localCachedAt) {
      return 'No local cache';
    }
    return `Cached locally ${localCachedAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}`;
  }, [localCachedAt]);

  const latestSyncEvent = useMemo(() => syncEvents[0] ?? null, [syncEvents]);

  const latestAutomatedEvent = useMemo(
    () => syncEvents.find((event) => event.triggeredBy === 'scheduled') ?? null,
    [syncEvents],
  );

  const latestFailureEvent = useMemo(
    () => syncEvents.find((event) => event.status === 'error') ?? null,
    [syncEvents],
  );

  const formatEventTimestamp = useCallback((date: Date | null) => {
    if (!date) {
      return 'Unknown time';
    }
    return date.toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      month: 'short',
      day: '2-digit',
    });
  }, []);

  const formatEventSummary = useCallback((event: typeof latestSyncEvent) => {
    if (!event) {
      return 'No sync activity recorded yet.';
    }

    if (event.status === 'error') {
      return event.errorMessage ?? 'Sync failed with an unknown error.';
    }

    const parts: string[] = [];
    if (typeof event.addedCount === 'number') {
      parts.push(`+${event.addedCount} added`);
    }
    if (typeof event.updatedCount === 'number') {
      parts.push(`${event.updatedCount} updated`);
    }
    if (typeof event.removedCount === 'number') {
      parts.push(`-${event.removedCount} removed`);
    }

    if (parts.length === 0) {
      return 'No data changes detected.';
    }

    return parts.join(' · ');
  }, []);

  const latestSyncLabel = useMemo(() => {
    if (!latestSyncEvent) {
      return 'No syncs yet';
    }
    const kind = latestSyncEvent.triggeredBy === 'scheduled' ? 'Automated' : 'Manual';
    return `${kind} sync ${formatEventTimestamp(latestSyncEvent.completedAt ?? latestSyncEvent.startedAt)}`;
  }, [formatEventTimestamp, latestSyncEvent]);

  const latestAutomatedLabel = useMemo(() => {
    if (!latestAutomatedEvent) {
      return 'No automated syncs yet';
    }
    const statusLabel =
      latestAutomatedEvent.status === 'success' ? 'Succeeded' : 'Failed';
    return `${statusLabel} ${formatEventTimestamp(
      latestAutomatedEvent.completedAt ?? latestAutomatedEvent.startedAt,
    )}`;
  }, [formatEventTimestamp, latestAutomatedEvent]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS Revolution</h1>
          <p>Everything you need for short-term rental listings, all in one place. Sync data with ArcGIS on demand at any time, and instantly query across 10s of thousands of listings.</p>
        </div>
        <div className="app__actions">
          <button
            type="button"
            className="app__refresh"
            onClick={async () => {
              setStatusMessage('Syncing dataset from ArcGIS…');
              try {
                await syncFromArcgis();
                setStatusMessage('Dataset synced successfully.');
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Failed to sync listings from ArcGIS.';
                setStatusMessage(message);
              }
            }}
            disabled={loading || syncing}
            title="Fetch fresh data from ArcGIS and replace the Supabase listings dataset."
          >
            {syncing ? 'Syncing…' : 'Sync from ArcGIS'}
          </button>
          <button
            type="button"
            className="app__clear-cache"
            onClick={async () => {
              setStatusMessage('Clearing local cache…');
              try {
                await clearCacheAndReload();
                setStatusMessage('Local cache cleared. Reloaded from Supabase.');
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Failed to clear local cache.';
                setStatusMessage(message);
              }
            }}
            disabled={loading || syncing}
            title="Delete the local cache and reload the dataset from Supabase."
          >
            Clear local cache
          </button>
          <span
            className={`app__cache${source === 'local' ? ' app__cache--active' : ''}`}
            title={localSummary}
          >
            {localSummary}
          </span>
          <span
            className={`app__cache${isLocalCacheStale ? ' app__cache--warn' : ''} ${
              source === 'supabase' || source === 'syncing' ? ' app__cache--active' : ''
            }`}
            title={supabaseSummary}
          >
            {supabaseSummary}
          </span>
          <div className="app__sync-history">
            <div
              className={`app__sync-card ${
                latestSyncEvent?.status === 'error'
                  ? 'app__sync-card--error'
                  : latestSyncEvent
                  ? 'app__sync-card--ok'
                  : 'app__sync-card--idle'
              }`}
            >
              <span className="app__sync-card-label">Latest sync</span>
              <span className="app__sync-card-value">{latestSyncLabel}</span>
              <span className="app__sync-card-meta">{formatEventSummary(latestSyncEvent)}</span>
            </div>
            <div
              className={`app__sync-card ${
                latestAutomatedEvent?.status === 'error'
                  ? 'app__sync-card--error'
                  : latestAutomatedEvent
                  ? 'app__sync-card--ok'
                  : 'app__sync-card--idle'
              }`}
            >
              <span className="app__sync-card-label">Automated sync</span>
              <span className="app__sync-card-value">{latestAutomatedLabel}</span>
              <span className="app__sync-card-meta">
                {latestAutomatedEvent
                  ? formatEventSummary(latestAutomatedEvent)
                  : 'Waiting for the first scheduled sync run.'}
              </span>
            </div>
            <div
              className={`app__sync-card ${
                latestFailureEvent ? 'app__sync-card--error' : 'app__sync-card--idle'
              }`}
            >
              <span className="app__sync-card-label">Last failure</span>
              <span className="app__sync-card-value">
                {latestFailureEvent
                  ? `Failure ${formatEventTimestamp(
                      latestFailureEvent.completedAt ?? latestFailureEvent.startedAt,
                    )}`
                  : 'No recent failures'}
              </span>
              <span className="app__sync-card-meta">
                {latestFailureEvent
                  ? formatEventSummary(latestFailureEvent)
                  : 'All monitored syncs have completed successfully.'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <section className="app__status" role="status" aria-live="polite">
        {statusMessage}
      </section>

      <main className="app__content">
        <Outlet context={contextValue} />
      </main>
    </div>
  );
}

function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/complex/:complexId" element={<ComplexDetailPage />} />
        <Route path="/owner/:ownerId" element={<OwnerDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;

