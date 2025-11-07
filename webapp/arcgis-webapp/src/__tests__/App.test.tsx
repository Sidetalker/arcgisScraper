import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import App from '@/App';
import { CacheProvider } from '@/context/CacheContext';
import { ListingsProvider } from '@/context/ListingsContext';
import { WatchlistsProvider } from '@/context/WatchlistsContext';

vi.mock('@/services/arcgisClient', async () => {
  const actual = await vi.importActual<typeof import('@/services/arcgisClient')>(
    '@/services/arcgisClient',
  );
  return {
    ...actual,
    fetchListings: vi.fn(() => Promise.resolve({ features: [] })),
  };
});

vi.mock('@/services/listingStorage', () => ({
  fetchStoredListings: vi.fn(() =>
    Promise.resolve({ records: [], latestUpdatedAt: null, blacklistedOwners: [] }),
  ),
  replaceAllListings: vi.fn(() => Promise.resolve()),
  updateListingFavorite: vi.fn(() => Promise.resolve({ record: {} as unknown, updatedAt: null })),
  updateListingDetails: vi.fn(() => Promise.resolve({ record: {} as unknown, updatedAt: null })),
  removeListingCustomization: vi.fn(() => Promise.resolve({ record: {} as unknown, updatedAt: null })),
  addOwnerToBlacklist: vi.fn(() =>
    Promise.resolve({
      entry: { ownerName: '', ownerNameNormalized: '', createdAt: null, updatedAt: null },
      updatedAt: null,
    }),
  ),
  removeOwnerFromBlacklist: vi.fn(() =>
    Promise.resolve({ ownerNameNormalized: '', updatedAt: null }),
  ),
}));

vi.mock('@/services/listingLocalCache', () => ({
  loadListingsFromCache: vi.fn(() => Promise.resolve(null)),
  saveListingsToCache: vi.fn(() => Promise.resolve(new Date())),
}));

vi.mock('@/services/configurationProfiles', () => ({
  fetchConfigurationProfiles: vi.fn(() => Promise.resolve([])),
  saveConfigurationProfile: vi.fn(() =>
    Promise.resolve({
      id: 'test-profile',
      name: 'Test profile',
      filters: { searchTerm: '', complex: '', owner: '' },
      regions: [],
      updatedAt: null,
    }),
  ),
}));

describe('App', () => {
  const renderApp = () =>
    render(
      <BrowserRouter>
        <CacheProvider>
          <ListingsProvider>
            <WatchlistsProvider>
              <App />
            </WatchlistsProvider>
          </ListingsProvider>
        </CacheProvider>
      </BrowserRouter>,
    );

  it('renders the heading', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: /arcgis/i })).toBeInTheDocument();
  });

  it('renders the data source badge', async () => {
    renderApp();
    expect(await screen.findByText(/data source: october 2025/i)).toBeInTheDocument();
  });

  it('renders the filter sidebar', async () => {
    renderApp();
    expect(await screen.findByLabelText(/filters/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/search listings/i)).toBeInTheDocument();
  });

  it('renders the Blacklisted navigation tab', async () => {
    renderApp();
    expect(await screen.findByRole('link', { name: /blacklisted/i })).toBeInTheDocument();
  });
});
