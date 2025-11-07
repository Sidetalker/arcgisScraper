import { useCallback, useMemo, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';

import './App.css';

import HomePage from '@/pages/HomePage';
import ComplexDetailPage from '@/pages/ComplexDetailPage';
import FavoritesPage from '@/pages/FavoritesPage';
import BlacklistedPage from '@/pages/BlacklistedPage';
import ManualEditsPage from '@/pages/ManualEditsPage';
import OwnerDetailPage from '@/pages/OwnerDetailPage';
import PasswordModal from '@/components/PasswordModal';
import { useListings } from '@/context/ListingsContext';
import WatchlistDetailPage from '@/pages/WatchlistDetailPage';
import { useWatchlists } from '@/context/WatchlistsContext';

export type LayoutOutletContext = {
  setStatusMessage: (message: string) => void;
};

function Layout(): JSX.Element {
  const {
    listings,
    loading,
    cachedAt,
    localCachedAt,
    isLocalCacheStale,
    source,
    syncing,
    syncFromArcgis,
    clearCacheAndReload,
  } = useListings();
  const { watchlists } = useWatchlists();
  const [statusMessage, setStatusMessage] = useState('Loading listings…');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const handleStatusChange = useCallback((message: string) => {
    setStatusMessage(message || 'Ready.');
  }, []);

  const handleSyncClick = useCallback(() => {
    setPasswordError(null);
    setIsPasswordModalOpen(true);
  }, []);

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      if (password === 'kevadmin') {
        setIsPasswordModalOpen(false);
        setPasswordError(null);
        setStatusMessage('Syncing dataset from ArcGIS…');
        try {
          await syncFromArcgis();
          setStatusMessage('Dataset synced successfully.');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to sync listings from ArcGIS.';
          setStatusMessage(message);
        }
      } else {
        setPasswordError('Incorrect password. Please try again.');
        setTimeout(() => setPasswordError(null), 3000);
      }
    },
    [syncFromArcgis],
  );

  const handlePasswordModalClose = useCallback(() => {
    setIsPasswordModalOpen(false);
    setPasswordError(null);
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

  const manualEditCount = useMemo(() => {
    return listings.filter((listing) => listing.hasCustomizations).length;
  }, [listings]);

  const blacklistedCount = useMemo(() => {
    return listings.filter((listing) => listing.isOwnerBlacklisted).length;
  }, [listings]);

  const manualEditsLabel = useMemo(() => {
    if (manualEditCount === 0) {
      return 'Manual edits';
    }
    return `Manual edits (${manualEditCount.toLocaleString()})`;
  }, [manualEditCount]);

  const blacklistedLabel = useMemo(() => {
    if (blacklistedCount === 0) {
      return 'Blacklisted';
    }
    return `Blacklisted (${blacklistedCount.toLocaleString()})`;
  }, [blacklistedCount]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>ArcGIS Revolution</h1>
          <p>Everything you need for short-term rental listings, all in one place. Sync data with ArcGIS on demand at any time, and instantly query across 10s of thousands of listings.</p>
          <span className="app__datasource-badge" title="Last update of the underlying ArcGIS feature layer">
            Data Source: October 2025
          </span>
        </div>
        <div className="app__actions">
          <button
            type="button"
            className="app__refresh"
            onClick={handleSyncClick}
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
        </div>
      </header>

      <nav className="app__tabs" aria-label="Listing views">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `app__tab${isActive ? ' app__tab--active' : ''}`}
        >
          All listings
        </NavLink>
        <NavLink
          to="/favorites"
          className={({ isActive }) => `app__tab${isActive ? ' app__tab--active' : ''}`}
        >
          Favorites
        </NavLink>
        <NavLink
          to="/blacklisted"
          className={({ isActive }) => `app__tab${isActive ? ' app__tab--active' : ''}`}
        >
          {blacklistedLabel}
        </NavLink>
        <NavLink
          to="/manual-edits"
          className={({ isActive }) => `app__tab${isActive ? ' app__tab--active' : ''}`}
          title="View listings that have been manually edited"
        >
          {manualEditsLabel}
        </NavLink>
        {watchlists.map((watchlist) => {
          const count = watchlist.listingIds.length;
          const label = `${watchlist.name}${count > 0 ? ` (${count.toLocaleString()})` : ''}`;
          return (
            <NavLink
              key={watchlist.id}
              to={`/watchlists/${watchlist.id}`}
              className={({ isActive }) => `app__tab${isActive ? ' app__tab--active' : ''}`}
              title={`Open the ${watchlist.name} watchlist`}
            >
              {label}
            </NavLink>
          );
        })}
      </nav>

      <section className="app__status" role="status" aria-live="polite">
        {statusMessage}
      </section>

      <main className="app__content">
        <Outlet context={contextValue} />
      </main>

      <PasswordModal
        isOpen={isPasswordModalOpen}
        onClose={handlePasswordModalClose}
        onSubmit={handlePasswordSubmit}
        title="Sync Authentication"
        message={
          passwordError
            ? passwordError
            : 'Please enter the administrator password to sync from ArcGIS.'
        }
      />
      <Analytics />
    </div>
  );
}

function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/blacklisted" element={<BlacklistedPage />} />
        <Route path="/manual-edits" element={<ManualEditsPage />} />
        <Route path="/watchlists/:watchlistId" element={<WatchlistDetailPage />} />
        <Route path="/complex/:complexId" element={<ComplexDetailPage />} />
        <Route path="/owner/:ownerId" element={<OwnerDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
