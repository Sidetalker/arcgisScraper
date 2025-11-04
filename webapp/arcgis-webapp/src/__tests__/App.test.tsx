import { render, screen } from '@testing-library/react';
import App from '@/App';
import { CacheProvider } from '@/context/CacheContext';

describe('App', () => {
  const renderApp = () =>
    render(
      <CacheProvider>
        <App />
      </CacheProvider>,
    );

  it('renders the heading', () => {
    renderApp();
    expect(
      screen.getByRole('heading', { name: /arcgis web app/i })
    ).toBeInTheDocument();
  });

  it('renders the filter sidebar', () => {
    renderApp();
    expect(screen.getByLabelText(/filters/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search listings/i)).toBeInTheDocument();
  });
});
