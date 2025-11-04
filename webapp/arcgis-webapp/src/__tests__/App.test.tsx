import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import App from '@/App';
import { CacheProvider } from '@/context/CacheContext';
import { ListingsProvider } from '@/context/ListingsContext';

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
  fetchStoredListings: vi.fn(() => Promise.resolve({ records: [], latestUpdatedAt: null })),
  replaceAllListings: vi.fn(() => Promise.resolve()),
}));

describe('App', () => {
  const renderApp = () =>
    render(
      <BrowserRouter>
        <CacheProvider>
          <ListingsProvider>
            <App />
          </ListingsProvider>
        </CacheProvider>
      </BrowserRouter>,
    );

  it('renders the heading', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: /arcgis/i })).toBeInTheDocument();
  });

  it('renders the filter sidebar', async () => {
    renderApp();
    expect(await screen.findByLabelText(/filters/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/search listings/i)).toBeInTheDocument();
  });
});
