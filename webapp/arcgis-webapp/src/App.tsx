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
  const { refresh, loading, cachedAt } = useListings();
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

  const cacheSummary = useMemo(() => {
    if (!cachedAt) {
      return 'No cached results';
    }
    return `Cached ${cachedAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}`;
  }, [cachedAt]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS Web App</h1>
          <p>Explore Summit County short-term rental listings with instant filtering and pagination.</p>
        </div>
        <div className="app__actions">
          <button
            type="button"
            className="app__refresh"
            onClick={refresh}
            disabled={loading}
            title="Clear cached ArcGIS data and request fresh results."
          >
            Refresh data
          </button>
          <span className="app__cache" title={cacheSummary}>
            {cacheSummary}
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
