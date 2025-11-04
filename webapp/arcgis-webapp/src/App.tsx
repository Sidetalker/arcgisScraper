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
      return 'No Supabase sync yet';
    }
    return `Synced ${cachedAt.toLocaleTimeString([], {
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

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS 2.0</h1>
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
